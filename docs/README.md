# 发送消息的理解

如果采用 CDC Outbox 策略，客户端发送消息时先生成 `client_message_id`，用于服务端识别同一次发送请求并保证幂等。`im-chat` 收到消息后，先基于 WebSocket 连接上下文确认发送者身份并校验消息格式；随后在同一个 MySQL 事务中完成会话成员校验、幂等处理、会话序号分配、消息落库和 Outbox 事件写入。

`conversation_seq` 是每条消息在单个会话内的递增序号，应写入 `messages` 表。`conversations` 表可以保存 `last_seq`，用于在事务中分配下一条消息的 `conversation_seq`。分配时不能简单地先查最大值再加一，而应在事务内锁定对应会话行，递增 `last_seq`，再写入消息，避免同一会话并发发送时分配出重复序号。

`outbox_events` 是事件发布表，不是消息状态表。采用 CDC 后，应用服务只需要在同一个事务中插入一条 `message_created` outbox 事件；Debezium 或其他 CDC 组件监听 MySQL binlog，把这条 outbox insert 转换为 Kafka 消息。这样就不需要 `im-chat` 后台扫描 `pending` 事件，也不需要多个 `im-chat` 实例抢占同一批 outbox 记录。

事务提交成功后，`im-chat` 可以通过 WebSocket 回复发送方 `server_accepted`，表示消息已经可靠写入 MySQL。这个确认不表示 Kafka 已经发布成功，也不表示接收方设备已经收到或用户已经阅读。

# CDC Outbox 发送链路

## 第一阶段：客户端生成本地消息

用户在输入框按下发送时，客户端先生成一条本地消息：

1. 生成全局唯一的 `client_message_id`，通常可以使用 UUID。
2. 立即在本地 UI 渲染这条消息，状态显示为“发送中”。
3. 通过 WebSocket 向 `im-chat` 发送 `send_message` 请求，携带 `client_message_id`、`conversation_id`、消息内容、客户端发送时间等信息。

`client_message_id` 只表示客户端的一次发送请求，不是最终的服务端消息 ID。它的核心作用是处理网络重试：如果客户端因为超时重发同一条消息，服务端可以识别这是重复请求，而不是一条新的聊天消息。

## 第二阶段：服务端接收、幂等处理与事务写入

本阶段描述 `im-chat` 收到客户端 `send_message` 后，如何确认发送者身份、处理客户端重试、分配会话内序号，并在同一个 MySQL 事务中写入正式消息和 Outbox 事件。

### 2.1 鉴权模型、服务发现与连接状态

鉴权模型采用“短期 JWT `access_token` + Redis `refresh_token`”。登录、免登录和 WebSocket 在线状态需要分开理解：

```text
access_token
  短期 JWT。用于认证 API 请求和 WebSocket 连接。

refresh_token
  长期随机 token。用于免输入账号密码刷新 access_token。
  服务端只保存 refresh_token hash，并通过 Redis TTL 控制有效期。
  当前认证实现按单用户单 refresh token 处理，同一用户重新账号密码登录会替换旧 token。

WebSocket 在线状态
  表示用户当前是否有一条活着的 im-chat 连接。
  im-chat 只有持续收到客户端 WebSocket heartbeat 时，才继续维护 Redis presence。
  它不等于登录凭证，也不决定 refresh_token 是否有效。
```

登录流程：

```text
客户端输入账号密码
  -> im-api 校验账号密码
  -> im-api 删除同用户旧 refresh_token 主记录和用户索引
  -> im-api 签发短期 JWT access_token
  -> im-api 生成长期 refresh_token
  -> im-api 将 refresh_token hash 写入 Redis，并设置 TTL
  -> im-api 写入 refresh_token_by_user:{user_id}，记录当前用户最新 refresh token hash
  -> im-api 查询 Redis service registry，选择一个可用 im-chat 节点
  -> im-api 返回 user_id、access_token、refresh_token、access_token 过期时间和 im-chat WebSocket 地址
```

客户端保存策略：

```text
access_token
  可放在内存中，过期后通过 refresh_token 换新。

refresh_token
  需要持久化到客户端本地安全存储，用于下次启动免登录。
  客户端不会直接查询 Redis，Redis 只由服务端访问。
```

客户端启动后的免登录流程：

```text
客户端读取本地 refresh_token
  -> 调用 im-api /v1/auth/refresh
  -> im-api 查询 Redis 中的 refresh_token hash
  -> refresh_token 有效：签发新的 access_token，并返回 user_id 和可用 im-chat 地址
  -> refresh_token 保持原 token，不生成、不返回新的 refresh_token
  -> refresh_token 无效或过期：客户端清理本地凭证并回到登录页
```

主动退出登录和关闭客户端需要区分：

```text
关闭客户端 / 断网 / 崩溃
  只代表 WebSocket 离线。
  im-chat 通过连接断开或客户端 heartbeat 超时清理本机连接状态和 Redis presence。
  不删除 refresh_token，下次仍可免登录。

主动退出登录
  客户端调用 im-api /v1/auth/logout。
  im-api 删除 Redis 中的 refresh_token hash，并在索引值匹配时删除 refresh_token_by_user:{user_id}。
  客户端删除本地 access_token / refresh_token。
  WebSocket 断开后，im-chat 清理连接状态。
```

`im-chat` 启动后需要注册到 Redis service registry，供 `im-api` 为客户端选择连接地址：

```text
chat_nodes:{node_id} -> {
  node_id,
  public_ws_url,
  rpc_addr,
  last_heartbeat_at
}
TTL = 30s
```

`im-chat` 需要定期刷新该 key 的 TTL。正常关闭时主动删除；异常宕机时依靠 TTL 自动过期。当前阶段只部署一个 `im-chat`，因此 `im-api` 查询后通常只会返回唯一可用节点。

客户端拿到 WebSocket 地址后连接 `im-chat`。第一阶段建议采用“建连后第一条消息发送 `auth`”的方式，认证通过前不处理任何业务消息：

```text
客户端连接 im-chat
  -> 发送 auth 消息，携带 JWT access_token
  -> im-chat 校验 JWT 签名、过期时间和用户身份
  -> 校验通过：创建 ActiveConnection，并写入 ConnectionRegistry / Redis presence
  -> 客户端开始每 10s 发送 heartbeat，im-chat 基于该心跳继续刷新 Redis presence
  -> 校验失败：返回 auth_failed 或关闭连接
```

如果 access_token 已过期，客户端应调用 `im-api /v1/auth/refresh` 获取新的 access_token，再重新连接 `im-chat`。

WebSocket 认证消息示例：

```json
{
  "type": "auth",
  "request_id": "req-uuid",
  "payload": {
    "access_token": "jwt-access-token"
  }
}
```

认证成功后，`im-chat` 可以回复：

```json
{
  "type": "auth_ok",
  "request_id": "req-uuid",
  "payload": {
    "user_id": 20001,
    "connection_id": "connection-uuid",
    "access_token_expires_at": "2026-08-14T10:15:00.000Z"
  }
}
```

认证成功后，客户端应开始发送业务心跳：

```json
{
  "type": "heartbeat",
  "request_id": "req-uuid",
  "payload": {
    "sent_at": "2026-08-14T10:15:01.000Z"
  }
}
```

`im-chat` 收到后回复 `heartbeat_ok`，并记录当前连接最近一次客户端心跳时间。客户端建议每 10s 发送一次；如果 `im-chat` 超过 30s 未收到心跳，就停止刷新 Redis presence 并清理连接。

认证失败时，`im-chat` 可以回复 `auth_failed` 后关闭连接。若失败原因是 access_token 过期，客户端再调用 `im-api /v1/auth/refresh`。

当前阶段按单用户单连接语义实现，`im-chat` 本机连接表可以简化为：

```text
ConnectionRegistry
  user_id -> ActiveConnection

ActiveConnection
  connection_id             当前 WebSocket 连接 ID
  user_id                   当前连接对应的用户 ID
  sender                    WebSocket 发送句柄
  connected_at              建连时间
  access_token_expires_at   当前 access_token 过期时间
```

这里仍建议保留 `connection_id`。当同一用户快速重连时，旧连接的断开事件可能晚于新连接建立；断开清理时应确认当前 registry 中的 `connection_id` 仍等于旧连接 ID，避免误删新连接。

WebSocket 认证成功后，`im-chat` 同步写入 Redis presence：

```text
presence:user:{user_id} -> {
  node_id,
  connection_id,
  connected_at,
  last_heartbeat_at,
  access_token_expires_at
}
TTL = 30s
```

连接存活期间，`im-chat` 每 5s 尝试刷新 presence TTL；刷新前必须确认最近 30s 内收到过客户端 `heartbeat`，并且 Redis 中的 `connection_id` 仍然匹配当前连接。连接断开或客户端心跳超时时主动清理。当前单节点阶段，presence 查询结果通常指向当前 `im-chat`；若后续出现 `presence.node_id != current_node_id`，再通过 RPC 转发到目标节点。

### 2.2 事务外校验

`im-chat` 收到 `send_message` 后，先在事务外完成不依赖数据库一致性的校验：

1. 确认当前 WebSocket 连接已经认证，并能从 `ActiveConnection` 取得 `sender_user_id`。
2. 校验 `client_message_id` 是否存在、格式是否合法。
3. 校验 `conversation_id` 是否存在于请求中且格式合法。
4. 校验 `message_type` 是否是当前支持的类型。
5. 校验 `content` 结构、长度和大小限制。
6. 计算 `content_hash`，用于判断同一个 `client_message_id` 是否被错误复用于不同内容。

事务外校验的目标是尽早拒绝明显非法请求，避免无意义地开启数据库事务。

### 2.3 事务内处理流程

随后开启 MySQL 事务，在事务中完成与数据库一致性有关的操作：

1. 根据 `conversation_id` 和 `sender_user_id` 查询 `conversation_members`，确认发送者仍是该会话的有效成员。
2. 根据 `(sender_user_id, client_message_id)` 做幂等检查。
3. 如果已经存在对应消息，且 `conversation_id` 与 `content_hash` 均一致，说明这是客户端重试发送同一条消息，直接返回已有的 `message_id` 和 `conversation_seq`。
4. 如果已经存在对应消息，但 `conversation_id` 或 `content_hash` 不一致，说明客户端复用了同一个 `client_message_id` 发送不同内容，应返回冲突错误。
5. 如果不存在对应消息，锁定 `conversations` 中对应会话行，读取并递增 `last_seq`，得到新的 `conversation_seq`。
6. 生成服务端正式 `message_id`。
7. 向 `messages` 表写入消息事实。
8. 向 `outbox_events` 表插入一条 `message_created` 事件。`outbox_events` 的具体字段后续在 CDC/Kafka 设计中单独确定。

`messages` 和 `outbox_events` 必须在同一个本地事务中写入。只有事务提交成功后，`im-chat` 才能通过 WebSocket 回复发送方 `server_accepted`。

`server_accepted` 只表示消息已经成为服务端正式历史，不表示 Kafka 已经发布成功，也不表示接收方客户端已经收到或用户已经阅读。

### 2.4 表结构草案

#### `conversations`

保存会话本身的信息。第一阶段虽然只做单聊，但仍保留可扩展结构，避免后续群聊推翻主链路。

```sql
CREATE TABLE conversations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_type VARCHAR(16) NOT NULL,
  last_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
);
```

字段说明：

```text
id
  会话 ID。

conversation_type
  会话类型。第一阶段可以是 direct，后续可扩展 group。

last_seq
  当前会话已经分配出去的最大 conversation_seq。
  发送新消息时，需要在事务中锁定当前 conversation 行并递增该字段。

created_at / updated_at
  会话创建和更新时间。
```

#### `conversation_members`

保存会话成员关系。即使第一阶段只做单聊，也可以保留该表，让“会话信息”和“成员列表”解耦。

```sql
CREATE TABLE conversation_members (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  member_state VARCHAR(16) NOT NULL,
  joined_at DATETIME(6) NOT NULL,
  left_at DATETIME(6) NULL,

  PRIMARY KEY (conversation_id, user_id),
  INDEX idx_conversation_members_user (user_id, member_state)
);
```

字段说明：

```text
conversation_id
  会话 ID。

user_id
  成员用户 ID。

member_state
  成员状态。第一阶段至少需要 active。
  后续可扩展 left、removed、muted 等状态。

joined_at
  加入会话时间。

left_at
  离开会话时间。仍在会话中时为空。
```

#### `messages`

保存正式聊天消息。它是消息历史的事实来源。

```sql
CREATE TABLE messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  message_id CHAR(36) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  conversation_seq BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  client_message_id CHAR(36) NOT NULL,
  message_type VARCHAR(32) NOT NULL,
  content JSON NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,

  UNIQUE KEY uk_messages_message_id (message_id),
  UNIQUE KEY uk_messages_conversation_seq (conversation_id, conversation_seq),
  UNIQUE KEY uk_messages_sender_client_msg (sender_user_id, client_message_id),
  INDEX idx_messages_conversation_created (conversation_id, created_at)
);
```

字段说明：

```text
id
  数据库内部自增主键。

message_id
  服务端正式消息 ID。客户端后续撤回、编辑、引用、定位消息时使用它。

conversation_id
  消息所属会话 ID。

conversation_seq
  消息在该会话内的递增序号，用于排序、补齐缺口、推进 delivered_seq/read_seq。
  同一 conversation 内必须唯一。

sender_user_id
  发送者用户 ID。

client_message_id
  客户端生成的发送请求 ID，用于处理客户端重试。
  同一 sender_user_id 下必须唯一。

message_type
  消息类型。第一阶段可以只支持 text，后续可扩展 image、file、audio 等。

content
  消息内容。使用 MySQL JSON 类型保存。
  文本消息也可以保存为 { "text": "hello" }。
  这样后续可以承载图片、文件、语音等不同消息结构。

content_hash
  对规范化后的消息内容计算 SHA-256，用于判断同一个 client_message_id 是否被复用于不同内容。

created_at
  服务端消息创建时间。
```

`content JSON` 的取舍：

```text
优点：
  可以承载多种消息类型。
  MySQL 会校验 JSON 合法性。
  后续可以扩展文本、图片、文件、音频等结构。

注意：
  每种 message_type 对应的 content schema 需要后续单独设计。
  第一阶段 text 消息可先约定为 { "text": "..." }。
```

### 2.5 客户端发送消息结构

客户端通过 WebSocket 发送：

```json
{
  "type": "send_message",
  "request_id": "req-uuid",
  "payload": {
    "client_message_id": "client-msg-uuid",
    "conversation_id": 10001,
    "message_type": "text",
    "content": {
      "text": "hello"
    },
    "client_sent_at": "2026-08-14T10:00:00.000Z"
  }
}
```

字段说明：

```text
type
  WebSocket 消息类型。发送消息时为 send_message。

request_id
  本次 WebSocket 请求 ID，用于客户端匹配响应。

client_message_id
  客户端生成的消息发送幂等 ID。

conversation_id
  目标会话 ID。

message_type
  消息类型。

content
  消息内容。第一阶段 text 消息使用 { "text": "..." }。

client_sent_at
  客户端发送时间，仅用于客户端体验或排查，不作为服务端排序依据。
```

### 2.6 服务端确认结构

事务提交成功后，`im-chat` 回复发送方：

```json
{
  "type": "server_accepted",
  "request_id": "req-uuid",
  "payload": {
    "client_message_id": "client-msg-uuid",
    "message": {
      "message_id": "message-uuid",
      "conversation_id": 10001,
      "conversation_seq": 42,
      "sender_user_id": 20001,
      "client_message_id": "client-msg-uuid",
      "message_type": "text",
      "content": {
        "text": "hello"
      },
      "created_at": "2026-08-14T10:00:01.123Z"
    }
  }
}
```

字段说明：

```text
client_message_id
  用于客户端找到本地“发送中”的临时消息。

message_id
  服务端正式消息 ID。

conversation_id
  消息所属会话。

conversation_seq
  服务端分配的会话内递增序号。

sender_user_id
  发送者用户 ID。客户端可用它判断消息方向、展示头像昵称、处理权限逻辑。

message_type / content
  服务端确认后的标准消息内容。

created_at
  服务端创建时间。
```

幂等重试时，如果服务端发现 `(sender_user_id, client_message_id)` 已经处理过，且内容一致，也返回同样的 `server_accepted` 结构。这样客户端可以稳定地把本地临时消息绑定到服务端正式消息。

### 2.7 服务端拒绝结构

如果请求非法，服务端返回：

```json
{
  "type": "send_message_rejected",
  "request_id": "req-uuid",
  "payload": {
    "client_message_id": "client-msg-uuid",
    "error_code": "duplicate_client_message_conflict",
    "message": "client_message_id was reused with different content"
  }
}
```

常见错误码：

```text
unauthenticated
  当前 WebSocket 连接未认证或认证已失效。

invalid_message
  消息格式、类型、长度或内容非法。

conversation_not_found
  会话不存在。

not_conversation_member
  当前用户不是该会话的有效成员。

duplicate_client_message_conflict
  同一个 client_message_id 被复用于不同内容。

internal_error
  服务端内部错误。
```

## 第三阶段：CDC 将 Outbox 事件发布到 Kafka

本阶段负责把 `im-chat` 在 MySQL 事务中写入的 `outbox_events` 事件发布到 Kafka。采用 CDC 后，`im-chat` 不再扫描 `outbox_events`，也不再维护 `pending`、`publishing`、`published` 这类发布状态。事件是否已经被捕获和发布，由 Debezium / Kafka Connect 的 binlog 读取位置和 connector offset 管理。

### 3.1 `outbox_events` 的定位

`outbox_events` 是数据库中的事件表，不是消息状态表，也不是聊天历史表。

它的作用是：

```text
在业务事务中记录“需要发布到 Kafka 的领域事件”
```

对于发送消息链路，`messages` 保存正式聊天消息，`outbox_events` 保存与这条消息对应的 `message_created` 事件。两者必须在同一个 MySQL 事务中写入。

采用 Debezium Outbox Event Router 后，`outbox_events` 可以按 append-only 表设计：

```text
只插入事件
不需要 pending / publishing / published 状态
不由 im-chat 后台扫描
不由 im-chat 修改发布状态
```

### 3.2 `outbox_events` 表结构草案

```sql
CREATE TABLE outbox_events (
  id CHAR(36) PRIMARY KEY,
  aggregatetype VARCHAR(255) NOT NULL,
  aggregateid VARCHAR(255) NOT NULL,
  type VARCHAR(255) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,

  INDEX idx_outbox_events_created (created_at)
);
```

字段说明：

```text
id
  事件 ID。全局唯一。
  下游 Consumer 可以用它做幂等去重。

aggregatetype
  事件所属的业务聚合类型。
  对聊天消息事件，第一阶段可以使用 chat_message。
  它不是 Kafka topic 本身，但 Debezium 可以使用它决定 topic 或写入 Kafka headers。

aggregateid
  事件所属的具体业务对象 ID。
  对聊天消息事件，建议填 conversation_id。
  Debezium 默认可以用它作为 Kafka record key。
  Kafka 会根据 key 分区，因此同一个 conversation_id 的事件会进入同一个分区。

type
  业务事件类型，不是发布状态。
  第一阶段可以是 message_created。
  后续可扩展 message_edited、message_recalled、message_deleted 等。

payload
  事件业务内容。
  通常会被 Debezium 映射为 Kafka record value，也就是 Consumer 真正解析的业务正文。

created_at
  事件创建时间。
  用于排查、监控、延迟计算和后续归档清理。
```

### 3.3 示例 outbox 记录

```json
{
  "id": "event-uuid",
  "aggregatetype": "chat_message",
  "aggregateid": "10001",
  "type": "message_created",
  "payload": {
    "event_id": "event-uuid",
    "event_type": "message_created",
    "aggregate_type": "chat_message",
    "aggregate_id": "10001",
    "event_version": 1,
    "message": {
      "message_id": "message-uuid",
      "conversation_id": 10001,
      "conversation_seq": 42,
      "sender_user_id": 20001,
      "client_message_id": "client-msg-uuid",
      "message_type": "text",
      "content": {
        "text": "hello"
      },
      "created_at": "2026-08-14T10:00:01.123Z"
    }
  },
  "created_at": "2026-08-14T10:00:01.123Z"
}
```

这里建议 `payload` 保存完整事件 envelope，而不是只保存 `message`。这样 Consumer 即使不读取 Kafka headers，也能从 `value` 中拿到完整上下文，方便调试和兼容演进。

### 3.4 Debezium 的映射关系

Debezium MySQL Connector 读取 MySQL binlog。Debezium Outbox Event Router 捕获 `outbox_events` 的新增记录，并把它转换成 Kafka record。

推荐映射关系：

```text
outbox_events.id
  -> Kafka headers.event_id
  -> 同时也保留在 payload.event_id

outbox_events.aggregatetype
  -> Kafka headers.aggregate_type
  -> 可用于路由 topic

outbox_events.aggregateid
  -> Kafka record key
  -> 对聊天消息事件，值为 conversation_id

outbox_events.type
  -> Kafka headers.event_type
  -> 同时也保留在 payload.event_type

outbox_events.payload
  -> Kafka record value
```

这样形成的关系是：

```text
数据库 outbox 行
  -> Debezium 捕获 binlog
  -> Kafka record
  -> im-chat Consumer 消费
```

### 3.5 CDC 方案需要保证的基础设施条件

CDC 方案把“Outbox 到 Kafka”的发布进度交给 Debezium / Kafka Connect 管理，因此需要保证：

```text
MySQL 开启 row-based binlog。
MySQL binlog 保留时间大于 CDC 最长故障恢复时间。
Kafka Connect offset topic 可靠保存。
Kafka topic 有合理副本数、ISR 和 ack 配置。
Debezium connector lag 需要监控和告警。
outbox_events 历史记录可以归档或清理，但不能早于 CDC 已确认消费的位置。
```

CDC 仍可能产生重复事件，因此下游 Consumer 和客户端必须保持幂等。

## 第四阶段：Kafka 保存实时分发事件

本阶段定义 Kafka 中保存的事件结构。Kafka 保存的是实时分发事件，不是聊天历史的唯一来源。聊天历史事实仍然以 MySQL `messages` 表为准。

Kafka 写入成功只表示事件进入实时分发链路，不表示客户端已收到，也不表示用户已读。

### 4.1 Kafka record 的组成

Consumer 从 Kafka 中取到的是完整 Kafka record，不是只有 `value`。

一条 Kafka record 可以理解为：

```text
topic
partition
offset
timestamp
key
headers
value
```

其中业务最关心：

```text
topic
  事件所在主题。

key
  用于分区。
  聊天消息建议使用 conversation_id。

headers
  轻量元信息，例如 event_id、event_type、aggregate_type。
  Consumer 可以不解析完整 value，就先判断事件类型或做幂等。

value
  主要业务内容，也可以理解为 body。
  对 CDC Outbox 来说，通常来自 outbox_events.payload。
```

### 4.2 Topic 设计

第一阶段建议使用一个聊天消息事件 topic：

```text
whisper.chat.message-events.v1
```

命名含义：

```text
whisper
  项目前缀。

chat
  业务域。

message-events
  事件类型集合，表示聊天消息相关事件。

v1
  协议版本。后续不兼容升级时可以新建 v2 topic。
```

### 4.3 Kafka key 设计

推荐使用 `conversation_id` 作为 Kafka record key：

```text
key = "10001"
```

原因：

```text
Kafka 只保证同一分区内有序，不保证整个 topic 全局有序。
同一个 conversation_id 使用同一个 key，会进入同一个分区。
这样同一会话内的 message_created、message_edited、message_recalled 等事件顺序更稳定。
```

### 4.4 Kafka headers 设计

推荐 headers：

```text
event_id: "event-uuid"
event_type: "message_created"
aggregate_type: "chat_message"
```

headers 的作用：

```text
event_id
  Consumer 幂等去重。

event_type
  Consumer 判断业务事件类型。

aggregate_type
  标识事件所属业务聚合类型。
```

headers 不是 value 的一部分。它们类似 HTTP header，是 Kafka record 上的轻量元信息。

### 4.5 Kafka value 设计

推荐 Kafka value 直接使用 `outbox_events.payload`，且 payload 保存完整事件 envelope：

```json
{
  "event_id": "event-uuid",
  "event_type": "message_created",
  "aggregate_type": "chat_message",
  "aggregate_id": "10001",
  "event_version": 1,
  "message": {
    "message_id": "message-uuid",
    "conversation_id": 10001,
    "conversation_seq": 42,
    "sender_user_id": 20001,
    "client_message_id": "client-msg-uuid",
    "message_type": "text",
    "content": {
      "text": "hello"
    },
    "created_at": "2026-08-14T10:00:01.123Z"
  }
}
```

这样 Consumer 只解析 value，也能获得完整事件上下文。headers 仍然可以用于快速判断和幂等，但不是唯一信息来源。

### 4.6 Consumer 读取 record 后能拿到什么

Consumer 消费 Kafka 时可以拿到完整 record：

```text
topic
partition
offset
timestamp
key
headers
value
```

处理 `message_created` 时可以按以下方式使用：

```text
headers.event_id 或 value.event_id
  用于幂等去重。

headers.event_type 或 value.event_type
  用于判断事件类型。

key 或 value.aggregate_id
  表示 conversation_id，可用于日志和分区语义校验。

value.message
  真正用于在线投递的消息内容。
```

### 4.7 顺序、重复和可靠性边界

第四阶段需要明确以下边界：

```text
Kafka topic 不保证全局顺序，只保证单分区内顺序。
同一 conversation_id 使用同一个 key，能让同一会话事件进入同一分区。
CDC、Kafka 或 Consumer 重试都可能带来重复事件。
Consumer 必须按 event_id 做幂等。
客户端必须按 message_id 做去重。
Kafka 写入成功不等于客户端已送达。
客户端送达仍由 delivered_ack / delivered_seq 表示。
用户已读仍由 read_ack / read_seq 表示。
```

## 第五阶段：Consumer 投递在线连接

本阶段负责把 Kafka 中的 `message_created` 事件投递给当前在线的会话成员。Kafka 只负责实时事件分发，离线消息仍以 MySQL `messages` 表为准。

当前阶段按单 `im-chat` 节点、单用户单连接语义实现，但保留 Redis presence 查询步骤，让流程和后续多节点演进方向一致。

### 5.1 投递前提

Consumer 处理 `message_created` 前，需要具备以下信息：

```text
current_node_id
  当前 im-chat 节点 ID。

ConnectionRegistry
  本机内存连接表，结构为 user_id -> ActiveConnection。

Redis presence
  用户在线路由表，结构为 presence:user:{user_id} -> node_id / connection_id / connected_at / last_heartbeat_at / access_token_expires_at。
  该 key 由 im-chat 在最近 30s 内收到客户端 heartbeat 且 connection_id 匹配时续期。
```

`ActiveConnection` 保存真实 WebSocket 发送句柄：

```text
ActiveConnection
  connection_id
  user_id
  sender
  connected_at
  access_token_expires_at
```

### 5.2 投递流程

`im-chat` 的 Kafka Consumer 消费 `message_created` 事件后：

1. 根据 `event_id` 做幂等检查，避免 CDC、Kafka 或 Consumer 重试导致同一事件被重复处理。
2. 解析 `value.message`，取得 `conversation_id`、`conversation_seq`、`message_id`、`sender_user_id` 等字段。
3. 根据 `conversation_id` 查询 `conversation_members`，得到该会话的所有有效成员。
4. 遍历所有会话成员，包括发送者本人。发送者也需要收到 `message_created`，用于确认服务端正式时间线事件。
5. 对每个 `member_user_id` 查询 Redis：`presence:user:{member_user_id}`。
6. 如果 presence 不存在，说明该用户当前离线，本次实时投递跳过该用户，不推进 `delivered_seq`。
7. 如果 `presence.node_id == current_node_id`，从本机 `ConnectionRegistry` 按 `member_user_id` 查询 `ActiveConnection`。
8. 如果本机连接存在，且 `ActiveConnection.connection_id == presence.connection_id`，通过 `ActiveConnection.sender` 推送 `message_created`。
9. 如果本机连接不存在，或 connection_id 不一致，说明 presence 可能已经过期或连接刚发生重连。本次实时投递可视为未送达；若实现主动删除 stale presence，也必须先校验 Redis 中的 `connection_id` 仍等于待删除的旧连接 ID，否则等待 TTL 自动过期。
10. 如果 `presence.node_id != current_node_id`，当前阶段不做跨节点转发，先保留 `TODO: 后续通过 RPC 转发到目标 im-chat 节点`。
11. 当前事件的投递决策完成后，再提交 Kafka offset。

这里不要因为 `member_user_id == sender_user_id` 就跳过发送者。发送方已经通过 `server_accepted` 得知“消息已落库”，但 `message_created` 代表“服务端正式时间线出现了这条消息”。发送方客户端收到后不会新增重复气泡，而是合并或确认已有本地消息。

### 5.3 WebSocket 推送结构

Consumer 向在线连接推送的结构建议为：

```json
{
  "type": "message_created",
  "payload": {
    "event_id": "event-uuid",
    "message": {
      "message_id": "message-uuid",
      "conversation_id": 10001,
      "conversation_seq": 42,
      "sender_user_id": 20001,
      "client_message_id": "client-msg-uuid",
      "message_type": "text",
      "content": {
        "text": "hello"
      },
      "created_at": "2026-08-14T10:00:01.123Z"
    }
  }
}
```

字段说明：

```text
event_id
  本次领域事件 ID。客户端和服务端都可用于排查和幂等。

message_id
  服务端正式消息 ID。客户端按它去重。

conversation_id
  消息所属会话 ID。

conversation_seq
  会话内递增序号。客户端按它排序，并用它发现缺口。

sender_user_id
  发送者用户 ID。客户端用它判断消息方向。

client_message_id
  发送方客户端生成的幂等 ID。
  对发送者客户端，它可用于把服务端正式事件和本地“发送中”消息关联起来。

message_type / content
  标准消息类型和内容。

created_at
  服务端创建时间。
```

## 第六阶段：客户端接收、去重和回执

本阶段描述客户端收到 `server_accepted` 和 `message_created` 后如何更新本地消息列表，以及如何上报送达和已读。

这里的“本地消息列表”第一阶段可以只是客户端内存状态，例如某个会话下的 `messages` 数组；后续如果增加本地缓存，也可以落到客户端 SQLite、IndexedDB 或其他本地存储。它不是服务端 MySQL `messages` 表。

### 6.1 发送方处理 `server_accepted`

用户点击发送时，客户端已经先创建了一条本地临时消息：

```text
local_status = sending
client_message_id = 客户端生成的 UUID
message_id = null
conversation_seq = null
```

收到 `server_accepted` 后，客户端按 `client_message_id` 找到这条临时消息，并补齐服务端字段：

```text
message_id
conversation_seq
sender_user_id
created_at
local_status = accepted
```

`server_accepted` 的语义是“消息已经成功写入服务端数据库”。它不表示接收方已经收到，也不表示用户已读。

### 6.2 客户端处理 `message_created`

客户端收到 `message_created` 后，先按 `message_id` 做去重：

```text
如果本地已经存在相同 message_id
  -> 合并 / 更新已有消息，不新增 UI 气泡

如果本地不存在相同 message_id
  -> 插入到对应会话的本地消息列表
```

对于接收方来说，`message_created` 通常会插入一条新消息。对于发送方来说，这条消息可能就是自己刚发出的消息，因此通常只会更新已有本地消息，例如确认 `created_at`、`conversation_seq`、最终 `content` 和发送状态，不重复展示。

如果发送方因为网络时序没有先收到 `server_accepted`，而是先收到了 `message_created`，也可以用 `client_message_id` 找到本地“发送中”的临时消息并完成合并。若 `message_id` 和 `client_message_id` 都找不到对应本地消息，再作为新消息插入。

### 6.3 排序、缺口和补拉

客户端应使用 `conversation_seq` 作为同一会话内的服务端排序依据：

```text
同一 conversation_id 内，按 conversation_seq 升序展示。
```

如果客户端发现收到的 `conversation_seq` 不连续，例如本地已连续收到 40，下一条直接收到 42，说明中间可能缺少 41。此时客户端不应该直接推进连续送达游标，而应向服务端补拉缺失消息：

```text
conversation_id = 10001
from_seq = 41
limit = N
```

补拉得到缺失消息后，客户端继续按 `message_id` 去重、按 `conversation_seq` 排序。只有确认从上一个游标开始已经连续收到，才能推进 `delivered_seq`。

### 6.4 `delivered_ack`

`delivered_ack` 表示客户端已经连续收到某个会话的消息到哪里。它确认的是“到达客户端”，不是“用户已经看过”。

客户端确认连续收到后发送：

```json
{
  "type": "delivered_ack",
  "request_id": "req-uuid",
  "payload": {
    "conversation_id": 10001,
    "delivered_seq": 42
  }
}
```

服务端收到后，应在游标表中更新当前用户在该会话下的 `delivered_seq`。该字段不应写在每一条 `messages` 记录上，而应使用按成员维护的游标表：

```sql
CREATE TABLE conversation_member_cursors (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  delivered_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  delivered_at DATETIME(6) NULL,
  read_at DATETIME(6) NULL,

  PRIMARY KEY (conversation_id, user_id)
);
```

更新时只能单调推进，不能回退：

```text
delivered_seq = GREATEST(delivered_seq, ack.delivered_seq)
```

### 6.5 `read_ack`

`read_ack` 表示用户已经实际阅读到某个会话的哪个位置。它通常由客户端在用户打开会话、消息进入可视区域或停留满足产品规则后发送。

客户端发送：

```json
{
  "type": "read_ack",
  "request_id": "req-uuid",
  "payload": {
    "conversation_id": 10001,
    "read_seq": 42
  }
}
```

服务端收到后，更新 `conversation_member_cursors.read_seq` 和 `read_at`，同样只能单调推进：

```text
read_seq = GREATEST(read_seq, ack.read_seq)
```

后续如果需要让对方看到“已读到哪里”，服务端可以再产生 `message_read` 或 `conversation_read` 事件并推送给会话内其他在线成员。第一阶段也可以先只保存 `read_seq`，暂不做已读状态广播。

`delivered_seq` 和 `read_seq` 不应混用：

```text
delivered_seq
  客户端确认连续收到到哪里。

read_seq
  用户确认阅读到哪里。
```

## 第七阶段：离线补齐

如果接收方离线，Kafka Consumer 仍然可以提交 offset，因为 Kafka 不是用户的离线收件箱。离线消息由 MySQL `messages` 保存。

用户重新上线后，客户端或服务端根据该会话的 `delivered_seq` 查询缺失消息：

```text
conversation_seq > delivered_seq
```

服务端批量补发缺失消息，客户端按 `message_id` 去重、按 `conversation_seq` 排序，确认连续收到后再推进 `delivered_seq`。

# 需要继续专项确认的问题

1. `messages`、`conversations`、`conversation_members`、`outbox_events`、幂等记录表和游标表的 DDL。
2. `conversation_seq` 的并发分配策略和唯一约束。
3. Debezium Connector、Outbox Event Router 和 Kafka topic 的配置。
4. MySQL binlog 保留时间、CDC 监控、connector lag 告警和故障恢复策略。
5. Kafka topic 分区键、consumer group、offset 提交策略和重复事件处理。
6. JWT 签名密钥管理、access_token 有效期、refresh_token TTL、刷新接口和退出登录接口的具体实现细节。
7. Redis service registry、Redis presence 的 key 命名、TTL、刷新频率和异常清理策略。
8. 跨节点投递时的 RPC 协议、超时、重试和幂等策略。

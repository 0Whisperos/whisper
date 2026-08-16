# 数据库表结构规划

本文档定义 `im-server` 最终需要落到 MySQL 的表结构。设计依据来自 `docs/README.md` 中的发送消息链路、CDC Outbox、Kafka 实时投递、客户端回执和离线补齐规划。

## 总体约定

- MySQL 表只保存服务端长期事实数据和 CDC Outbox 事件。
- `refresh_token hash` 保存到 Redis，并通过 Redis TTL 控制有效期。
- `chat_nodes:{node_id}` 属于 Redis service registry。
- `presence:user:{user_id}` 属于 Redis presence。
- Kafka 的 topic、key、headers、value、partition、offset 不是 MySQL 表。
- 不单独创建发送幂等记录表。发送幂等由 `messages` 表的唯一键 `uk_messages_sender_client_msg (sender_user_id, client_message_id)` 承担。
- 数据库中的时间字段使用 `DATETIME(6)` 保存。对外 API、WebSocket payload、Kafka payload 中的时间文本使用 GB/T 7408 扩展格式，包含日期、时间和时区偏移。
- UUID 字段暂按带连字符格式保存，使用 `CHAR(36)`。
- 第一阶段只支持 `conversation_type = 'direct'`、`message_type = 'text'`、`member_state = 'active'`。

## 表清单

| 表名 | 用途 |
| --- | --- |
| `users` | 保存账号凭证，并作为聊天相关表中 `user_id` 的来源。 |
| `conversations` | 保存会话主记录和该会话当前已分配的最大消息序号。 |
| `conversation_members` | 保存会话成员关系和成员状态。 |
| `messages` | 保存正式聊天消息，是聊天历史的事实来源。 |
| `outbox_events` | 保存待由 CDC 发布到 Kafka 的领域事件。 |
| `conversation_member_cursors` | 保存每个成员在每个会话中的送达和已读游标。 |

## `users`

### 表用途

`users` 保存登录账号和密码凭证。`id` 是后续聊天表中 `user_id`、`sender_user_id` 的来源。

### DDL 草案

```sql
CREATE TABLE users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account VARCHAR(12) NOT NULL,
  password_hash VARCHAR(60) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,

  UNIQUE KEY uk_users_account (account)
);
```

### 字段说明

| 字段名 | 类型 | 是否为空 | 默认值 | 索引/约束 | 字段含义 |
| --- | --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 否 | 自增 | 主键 | 用户 ID。系统内部使用的用户唯一标识，也是聊天成员、消息发送者和游标记录引用的用户标识。 |
| `account` | `VARCHAR(12)` | 否 | 无 | `uk_users_account` 唯一 | 登录账号。第一阶段沿用当前账号规则：8 到 12 位数字；数据库负责非空、最大长度和唯一性，具体格式由业务校验保证。 |
| `password_hash` | `VARCHAR(60)` | 否 | 无 | 无 | 密码哈希。保存 bcrypt 生成的密码摘要，不保存明文密码。 |
| `created_at` | `DATETIME(6)` | 否 | 无 | 无 | 用户记录创建时间。数据库保存时间值；系统边界输出时使用 GB/T 7408 扩展格式。 |
| `updated_at` | `DATETIME(6)` | 否 | 无 | 无 | 用户记录最后更新时间。数据库保存时间值；系统边界输出时使用 GB/T 7408 扩展格式。 |

## `conversations`

### 表用途

`conversations` 保存会话主记录。发送消息时需要在事务中锁定对应会话行，递增 `last_seq`，再把分配出的序号写入 `messages.conversation_seq`。

### DDL 草案

```sql
CREATE TABLE conversations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_type VARCHAR(16) NOT NULL,
  last_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
);
```

### 字段说明

| 字段名 | 类型 | 是否为空 | 默认值 | 索引/约束 | 字段含义 |
| --- | --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 否 | 自增 | 主键 | 会话 ID。客户端发送消息、补拉消息、上报回执时都使用该标识定位会话。 |
| `conversation_type` | `VARCHAR(16)` | 否 | 无 | 无 | 会话类型。第一阶段使用 `direct` 表示单聊，后续可扩展 `group` 等类型。 |
| `last_seq` | `BIGINT UNSIGNED` | 否 | `0` | 无 | 当前会话已经分配出去的最大 `conversation_seq`。发送新消息时在事务中递增该字段，用于避免同一会话并发发送时出现重复序号。 |
| `created_at` | `DATETIME(6)` | 否 | 无 | 无 | 会话创建时间。数据库保存时间值；系统边界输出时使用 GB/T 7408 扩展格式。 |
| `updated_at` | `DATETIME(6)` | 否 | 无 | 无 | 会话最后更新时间。通常在会话元数据变更或序号推进时更新；系统边界输出时使用 GB/T 7408 扩展格式。 |

## `conversation_members`

### 表用途

`conversation_members` 保存会话成员关系。发送消息前用它校验发送者是否为会话有效成员；实时投递时用它查询需要投递的成员列表。

### DDL 草案

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

### 字段说明

| 字段名 | 类型 | 是否为空 | 默认值 | 索引/约束 | 字段含义 |
| --- | --- | --- | --- | --- | --- |
| `conversation_id` | `BIGINT UNSIGNED` | 否 | 无 | 联合主键 `(conversation_id, user_id)` | 会话 ID。标识这条成员关系属于哪个会话。 |
| `user_id` | `BIGINT UNSIGNED` | 否 | 无 | 联合主键 `(conversation_id, user_id)`；索引 `idx_conversation_members_user` | 成员用户 ID。标识哪个用户属于该会话。 |
| `member_state` | `VARCHAR(16)` | 否 | 无 | 索引 `idx_conversation_members_user` | 成员状态。第一阶段至少使用 `active` 表示有效成员；后续可扩展 `left`、`removed`、`muted` 等状态。 |
| `joined_at` | `DATETIME(6)` | 否 | 无 | 无 | 用户加入会话的时间。数据库保存时间值；系统边界输出时使用 GB/T 7408 扩展格式。 |
| `left_at` | `DATETIME(6)` | 是 | `NULL` | 无 | 用户离开会话的时间。用户仍是会话成员时为空；系统边界输出时使用 GB/T 7408 扩展格式。 |

## `messages`

### 表用途

`messages` 保存正式聊天消息，是聊天历史的事实来源。客户端重试发送、离线补齐、消息排序、送达游标和已读游标都依赖该表。

### DDL 草案

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

### 字段说明

| 字段名 | 类型 | 是否为空 | 默认值 | 索引/约束 | 字段含义 |
| --- | --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | 否 | 自增 | 主键 | 数据库内部自增主键。用于数据库内部定位记录，不作为客户端协议中的正式消息 ID。 |
| `message_id` | `CHAR(36)` | 否 | 无 | `uk_messages_message_id` 唯一 | 服务端正式消息 ID。客户端后续撤回、编辑、引用、定位消息和去重时使用该标识。 |
| `conversation_id` | `BIGINT UNSIGNED` | 否 | 无 | `uk_messages_conversation_seq`；索引 `idx_messages_conversation_created` | 消息所属会话 ID。用于按会话查询消息历史、补拉离线消息和保证会话内序号唯一。 |
| `conversation_seq` | `BIGINT UNSIGNED` | 否 | 无 | `uk_messages_conversation_seq` | 消息在单个会话内的递增序号。客户端按它排序，发现缺口，并推进 `delivered_seq`、`read_seq`。同一会话内必须唯一。 |
| `sender_user_id` | `BIGINT UNSIGNED` | 否 | 无 | `uk_messages_sender_client_msg` | 发送者用户 ID。来自当前已认证 WebSocket 连接的用户身份，客户端可用它判断消息方向和展示发送者信息。 |
| `client_message_id` | `CHAR(36)` | 否 | 无 | `uk_messages_sender_client_msg` | 客户端生成的发送请求 ID。用于识别同一用户的重复发送请求，保证客户端重试不会产生多条正式消息。 |
| `message_type` | `VARCHAR(32)` | 否 | 无 | 无 | 消息类型。第一阶段使用 `text`，后续可扩展 `image`、`file`、`audio` 等类型。 |
| `content` | `JSON` | 否 | 无 | 无 | 消息内容。第一阶段文本消息使用类似 `{ "text": "hello" }` 的结构；后续不同 `message_type` 可以对应不同内容结构。 |
| `content_hash` | `CHAR(64)` | 否 | 无 | 无 | 规范化消息内容的 SHA-256 十六进制摘要。用于判断同一个 `client_message_id` 是否被错误复用于不同内容。 |
| `created_at` | `DATETIME(6)` | 否 | 无 | 索引 `idx_messages_conversation_created` | 服务端创建正式消息的时间。它是服务端时间线时间，不使用客户端发送时间排序；系统边界输出时使用 GB/T 7408 扩展格式。 |

## `outbox_events`

### 表用途

`outbox_events` 保存需要由 Debezium 或其他 CDC 组件发布到 Kafka 的领域事件。它是事件发布表，不是消息状态表；采用 append-only 设计，不维护 `pending`、`publishing`、`published` 等发布状态。

### DDL 草案

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

### 字段说明

| 字段名 | 类型 | 是否为空 | 默认值 | 索引/约束 | 字段含义 |
| --- | --- | --- | --- | --- | --- |
| `id` | `CHAR(36)` | 否 | 无 | 主键 | 事件 ID。全局唯一，下游 Consumer 可以使用它做幂等去重；payload 中也保留同一个事件 ID，方便不读取 Kafka headers 的消费者处理。 |
| `aggregatetype` | `VARCHAR(255)` | 否 | 无 | 无 | 事件所属的业务聚合类型。聊天消息事件第一阶段使用 `chat_message`，可供 Debezium Outbox Event Router 写入 Kafka headers 或决定 topic 路由。 |
| `aggregateid` | `VARCHAR(255)` | 否 | 无 | 无 | 事件所属的具体业务对象 ID。聊天消息事件建议填 `conversation_id` 的字符串形式，并作为 Kafka record key，使同一会话事件进入同一分区。 |
| `type` | `VARCHAR(255)` | 否 | 无 | 无 | 业务事件类型。第一阶段使用 `message_created`；后续可扩展 `message_edited`、`message_recalled`、`message_deleted` 等。它不是发布状态。 |
| `payload` | `JSON` | 否 | 无 | 无 | 事件业务内容。建议保存完整 event envelope，包括 `event_id`、`event_type`、`aggregate_type`、`aggregate_id`、`event_version` 和 `message`。 |
| `created_at` | `DATETIME(6)` | 否 | 无 | 索引 `idx_outbox_events_created` | 事件创建时间。用于排查、监控、延迟计算和后续归档清理；系统边界输出时使用 GB/T 7408 扩展格式。 |

## `conversation_member_cursors`

### 表用途

`conversation_member_cursors` 保存每个用户在每个会话下的送达和已读游标。送达和已读状态不写在每条 `messages` 记录上，而是按成员维护游标。

### DDL 草案

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

### 字段说明

| 字段名 | 类型 | 是否为空 | 默认值 | 索引/约束 | 字段含义 |
| --- | --- | --- | --- | --- | --- |
| `conversation_id` | `BIGINT UNSIGNED` | 否 | 无 | 联合主键 `(conversation_id, user_id)` | 会话 ID。标识这条游标记录属于哪个会话。 |
| `user_id` | `BIGINT UNSIGNED` | 否 | 无 | 联合主键 `(conversation_id, user_id)` | 用户 ID。标识这条游标记录属于哪个会话成员。 |
| `delivered_seq` | `BIGINT UNSIGNED` | 否 | `0` | 无 | 当前用户在该会话中已经连续收到的最大 `conversation_seq`。它表示消息接收进度，不表示用户自己发送的最后一条消息。客户端确认连续收到消息后上报，服务端更新时只能单调推进，不能回退。 |
| `read_seq` | `BIGINT UNSIGNED` | 否 | `0` | 无 | 当前用户在该会话中已阅读到的最大 `conversation_seq`。客户端根据打开会话、消息进入可视区域等产品规则上报，服务端更新时只能单调推进，不能回退。 |
| `delivered_at` | `DATETIME(6)` | 是 | `NULL` | 无 | `delivered_seq` 最近一次推进的时间。尚未收到任何送达回执时为空；系统边界输出时使用 GB/T 7408 扩展格式。 |
| `read_at` | `DATETIME(6)` | 是 | `NULL` | 无 | `read_seq` 最近一次推进的时间。尚未收到任何已读回执时为空；系统边界输出时使用 GB/T 7408 扩展格式。 |

## 发送消息事务要求

发送新消息时，`messages` 和 `outbox_events` 必须在同一个 MySQL 本地事务中写入。事务内的核心顺序是：

1. 根据 `conversation_id` 和 `sender_user_id` 查询 `conversation_members`，确认发送者是有效成员。
2. 根据 `(sender_user_id, client_message_id)` 查询 `messages`，处理幂等重试或冲突。
3. 锁定 `conversations` 对应行，递增 `last_seq`，得到新的 `conversation_seq`。
4. 写入 `messages`。
5. 写入 `outbox_events` 中的 `message_created` 事件。
6. 事务提交后，再向发送方返回 `server_accepted`。

`server_accepted` 只表示消息已经可靠写入 MySQL，不表示 Kafka 已经发布成功，也不表示接收方客户端已经收到或用户已经阅读。

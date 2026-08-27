# Redis 路由与在线状态规范

本文档定义 Redis 中的聊天节点路由、WebSocket 在线状态和认证续期状态边界。Redis 只保存临时路由和在线软状态；聊天历史、送达游标和已读游标仍以 MySQL 为事实来源。

设计依据：

- `docs/README.md` 已定义 `chat_nodes:{node_id}`、`presence:user:{user_id}`、TTL 30s，以及使用 `connection_id` 防止旧连接清理误删新连接。
- `docs/database-schema.md` 已明确 `refresh_token hash`、`chat_nodes:{node_id}`、`presence:user:{user_id}` 和 Kafka record 不进入 MySQL。
- Redis 官方文档中，`SET` 支持写入时设置过期时间，`EXPIRE` 用于设置 key TTL，Hash 适合保存简单对象字段。

参考资料：

- Redis `SET`: https://redis.io/docs/latest/commands/set/
- Redis `EXPIRE`: https://redis.io/docs/latest/commands/expire/
- Redis Hashes: https://redis.io/docs/latest/develop/data-types/hashes/

## 总体原则

- Redis 中的路由和在线状态都是软状态。key 不存在时，系统必须能按“节点不可用”或“用户离线”处理。
- Redis presence 不表示消息已送达，也不表示用户已读。送达和已读事实由 MySQL `conversation_member_cursors` 保存。
- `refresh_token` 的有效性不表示 WebSocket 在线。它只表示客户端可以尝试换取新的 `access_token`。
- `chat_nodes` 和 `presence` 的 TTL 均为 30s，刷新间隔为 10s；presence 刷新前必须确认当前连接最近 30s 内收到过客户端 `heartbeat`。
- Redis value 中的时间文本使用 GB/T 7408 扩展格式，包含日期、时间和时区偏移。
- 第一阶段保持单用户单连接语义。同一用户的新连接会覆盖旧连接的 presence。
- 涉及 `connection_id` 的 presence 续期和删除必须做条件校验，避免旧连接的迟到清理影响新连接。

## Key 清单

| Key | 类型 | Owner | TTL | 用途 |
| --- | --- | --- | --- | --- |
| `chat_nodes:{node_id}` | Hash | `im-chat` | 30s | 保存 `im-chat` 节点注册信息，供 `im-api` 选择 WebSocket 连接地址。 |
| `presence:user:{user_id}` | Hash | `im-chat` | 30s | 保存用户当前 WebSocket 在线路由，供 Kafka Consumer 投递在线消息。 |
| `refresh_token:{token_hash}` | String | `im-api` | 由认证策略决定 | 保存 refresh token 的服务端有效性状态，用于免登录续期；不属于在线状态。 |
| `refresh_token_by_user:{user_id}` | String | `im-api` | 与对应 refresh token 对齐 | 保存当前用户最新 refresh token hash，用于登录替换和 logout 清理；不属于在线状态。 |

## `chat_nodes:{node_id}`

### 用途

`chat_nodes:{node_id}` 保存单个 `im-chat` 节点的注册信息。`im-api` 在登录或刷新 token 成功后读取可用节点，并把可连接的 WebSocket 地址返回给客户端。

### 生命周期

```text
Key: chat_nodes:{node_id}
Type: Hash
Owner: im-chat
TTL: 30s
Refresh interval: 10s
Create: im-chat 启动并完成对外服务准备后写入
Refresh: im-chat 存活期间每 10s 刷新字段和 TTL
Delete: im-chat 正常关闭时主动删除；异常宕机依赖 TTL 自动过期
```

### 字段说明

| 字段名 | 是否必填 | 示例 | 字段含义 |
| --- | --- | --- | --- |
| `node_id` | 是 | `chat-001` | 聊天节点 ID。必须在当前部署环境内唯一，用于标识一个 `im-chat` 实例。 |
| `public_ws_url` | 是 | `ws://127.0.0.1:9001/ws` | 客户端可访问的 WebSocket 地址。`im-api` 把该地址返回给客户端。 |
| `rpc_addr` | 是 | `127.0.0.1:9101` | 节点间 RPC 地址。第一阶段不做跨节点转发，但保留该字段给后续 RPC 投递使用。 |
| `state` | 是 | `ready` | 节点状态。第一阶段可用 `ready` 表示可接入；非 `ready` 节点不应被 `im-api` 选中。 |
| `started_at` | 是 | `2026-08-16T12:00:00+08:00` | 节点启动并完成注册的时间，使用 GB/T 7408 扩展格式。 |
| `last_heartbeat_at` | 是 | `2026-08-16T12:00:10+08:00` | 最近一次刷新注册信息的时间，使用 GB/T 7408 扩展格式。 |

### 写入示例

```text
HSET chat_nodes:chat-001 \
  node_id chat-001 \
  public_ws_url ws://127.0.0.1:9001/ws \
  rpc_addr 127.0.0.1:9101 \
  state ready \
  started_at 2026-08-16T12:00:00+08:00 \
  last_heartbeat_at 2026-08-16T12:00:10+08:00
EXPIRE chat_nodes:chat-001 30
```

### 节点选择规则

`im-api` 选择聊天节点时：

1. 读取 `chat_nodes:*`。
2. 忽略已经不存在或 TTL 已过期的 key。
3. 只选择 `state = ready` 的节点。
4. 第一阶段单节点部署时，直接返回唯一可用节点。
5. 多节点负载均衡策略后续单独定义。

第一阶段可以扫描 `chat_nodes:*`。如果节点数量增长，再引入索引结构，例如 `chat_nodes:index`，以最近心跳时间作为 score。

## `presence:user:{user_id}`

### 用途

`presence:user:{user_id}` 保存用户当前 WebSocket 在线路由。Kafka Consumer 投递消息时根据该 key 判断用户是否在线，以及消息应投递到哪个 `im-chat` 节点。

### 生命周期

```text
Key: presence:user:{user_id}
Type: Hash
Owner: im-chat
TTL: 30s
Refresh interval: 10s
Create: WebSocket auth 成功后写入
Refresh: 连接存活且最近 30s 内收到客户端 heartbeat 时，每 10s 刷新字段和 TTL
Delete: WebSocket 断开、客户端 heartbeat 超时，且 connection_id 匹配时删除；异常断开依赖 TTL 自动过期
```

### 字段说明

| 字段名 | 是否必填 | 示例 | 字段含义 |
| --- | --- | --- | --- |
| `user_id` | 是 | `20001` | 当前在线用户 ID。必须与 key 中的 `{user_id}` 一致。 |
| `node_id` | 是 | `chat-001` | 当前持有该用户 WebSocket 连接的 `im-chat` 节点 ID。 |
| `connection_id` | 是 | `550e8400-e29b-41d4-a716-446655440000` | 当前 WebSocket 连接 ID。用于区分快速重连前后的新旧连接，防止旧连接清理误删新连接。 |
| `connected_at` | 是 | `2026-08-16T12:00:00+08:00` | 当前连接认证成功并进入在线状态的时间，使用 GB/T 7408 扩展格式。 |
| `last_heartbeat_at` | 是 | `2026-08-16T12:00:10+08:00` | 最近一次刷新 presence 的时间，使用 GB/T 7408 扩展格式。 |
| `access_token_expires_at` | 是 | `2026-08-16T12:15:00+08:00` | 当前连接使用的 access token 过期时间，使用 GB/T 7408 扩展格式。该字段用于连接侧判断认证有效期，不代表 refresh token 状态。 |

### 写入示例

```text
HSET presence:user:20001 \
  user_id 20001 \
  node_id chat-001 \
  connection_id 550e8400-e29b-41d4-a716-446655440000 \
  connected_at 2026-08-16T12:00:00+08:00 \
  last_heartbeat_at 2026-08-16T12:00:10+08:00 \
  access_token_expires_at 2026-08-16T12:15:00+08:00
EXPIRE presence:user:20001 30
```

### 建立连接规则

`im-chat` 建立 WebSocket 连接时：

1. 客户端连接后先发送 `auth` 消息。
2. `im-chat` 校验 `access_token`。
3. 认证成功后生成新的 `connection_id`。
4. 写入本机 `ConnectionRegistry`。
5. 写入 `presence:user:{user_id}` 并设置 30s TTL。
6. 同一用户新连接覆盖旧 presence，符合第一阶段单用户单连接语义。

### 客户端心跳与续期规则

`presence:user:{user_id}` 的续期由 `im-chat` 定时执行，但它不是无条件刷新。认证成功后，客户端应每 10s 通过 WebSocket 发送 `heartbeat`，`im-chat` 记录当前连接最近一次收到客户端心跳的时间。

每次 presence 续期前必须同时满足两个条件：

1. 当前连接最近 30s 内收到过客户端 `heartbeat`。
2. Redis 中的 `connection_id` 仍等于本连接 ID。

如果两个条件都满足：

- 更新 `last_heartbeat_at`。
- 续期 `presence:user:{user_id}` 到 30s。

如果客户端 `heartbeat` 超过 30s 未到达：

- 不刷新 TTL。
- 当前连接应停止维护 presence，并进入本机连接清理流程。
- 如果 Redis 中的 `connection_id` 仍匹配，本机清理流程会删除 `presence:user:{user_id}`；否则不影响新连接。

如果 Redis `connection_id` 不一致：

- 不刷新 TTL。
- 不覆盖 Redis 中的新 presence。
- 当前连接应停止维护 presence，并按本机连接状态决定是否关闭旧连接。

建议使用 Lua 脚本把 `connection_id` 比较、字段更新和 `EXPIRE` 封装为原子操作。

### 删除规则

WebSocket 断开清理时，`im-chat` 只能在 Redis 当前 `connection_id` 等于本连接 ID 时删除 `presence:user:{user_id}`。

如果不一致，说明同一用户已经建立了新连接，旧连接不能删除 presence。该规则也建议用 Lua 脚本保证检查和删除原子执行。

条件删除语义：

```text
if HGET presence:user:{user_id} connection_id == current_connection_id
  then DEL presence:user:{user_id}
else
  do nothing
```

## `refresh_token:{token_hash}` 与 `refresh_token_by_user:{user_id}`

### 用途边界

`refresh_token:{token_hash}` 保存 refresh token 的服务端有效性状态，用于客户端免登录续期。`refresh_token_by_user:{user_id}` 保存当前用户最新 refresh token hash，用于同一用户重新账号密码登录时替换旧 token。二者都属于认证续期状态，不属于在线状态。

```text
Key: refresh_token:{token_hash}
Owner: im-api
Purpose: 免登录续期凭证
Not presence: refresh token 有效不代表 WebSocket 在线
TTL: 由认证策略决定
Delete: 主动退出登录时删除；自然过期依赖 TTL

Key: refresh_token_by_user:{user_id}
Owner: im-api
Purpose: 当前用户最新 refresh token hash 索引
Not presence: 该索引存在不代表 WebSocket 在线
TTL: 与对应 refresh_token:{token_hash} 对齐
Delete: 同一用户重新登录替换时删除旧索引；主动退出登录且索引值匹配时删除；自然过期依赖 TTL
```

### 边界规则

- 客户端关闭、断网或崩溃只表示 WebSocket 离线，不删除 refresh token。
- 同一用户重新账号密码登录成功时，`im-api` 删除旧 refresh token，并写入新的 `refresh_token:{token_hash}` 与 `refresh_token_by_user:{user_id}`。
- 主动退出登录时，`im-api` 删除 refresh token，并在索引值仍匹配该 token 时删除 `refresh_token_by_user:{user_id}`；客户端删除本地 access token 和 refresh token。
- refresh token 有效时，客户端可以调用 `/v1/auth/refresh` 换取新的 access token，并重新获取可用 `im-chat` 地址。
- refresh token 无效或过期时，客户端清理本地凭证并回到登录页。

## Consumer 在线投递规则

Kafka Consumer 处理 `message_created` 事件时：

1. 根据 `conversation_id` 查询 MySQL `conversation_members`，得到有效成员列表。
2. 对每个 `member_user_id` 查询 `presence:user:{member_user_id}`。
3. 如果 presence 不存在，视为用户离线，本次实时投递跳过该用户，不推进 `delivered_seq`。
4. 如果 `presence.node_id == current_node_id`，继续查询本机 `ConnectionRegistry`。
5. 如果本机连接存在，且 `ActiveConnection.connection_id == presence.connection_id`，通过该连接推送 `message_created`。
6. 如果本机连接不存在，或 `connection_id` 不一致，视为本次未送达。实现可以删除 stale presence，也可以等待 TTL 自动过期。
7. 如果 `presence.node_id != current_node_id`，第一阶段不做跨节点转发；后续通过 RPC 转发到目标 `im-chat` 节点。

实时投递失败不影响消息可靠性。正式消息已经保存在 MySQL `messages` 中，用户重新上线后根据 `conversation_member_cursors.delivered_seq` 补齐缺失消息。

## 失败场景与处理

| 场景 | 处理 |
| --- | --- |
| `im-chat` 异常宕机 | `chat_nodes:{node_id}` 和该节点维护的 presence 依靠 TTL 自动过期。 |
| 用户网络断开但服务端未立即收到 close | `im-chat` 最多等待 30s 客户端 heartbeat 超时；超时后停止刷新 presence 并清理连接。异常情况下仍可依赖 TTL 自动过期。 |
| 用户快速重连 | 新连接覆盖 `presence:user:{user_id}`；旧连接清理时因 `connection_id` 不匹配而不能删除新 presence。 |
| Consumer 看到 presence 但本机无连接 | 视为 stale presence，本次不算送达，可删除或等待 TTL。 |
| refresh token 仍有效但 presence 不存在 | 用户可免登录，但当前 WebSocket 离线。 |
| presence 存在但 refresh token 已删除 | 当前 WebSocket 连接是否继续有效由 access token 过期时间决定；refresh token 删除不等于立即删除 presence。 |

## 实现检查清单

- `chat_nodes:{node_id}` 使用 Hash，字段包括 `node_id`、`public_ws_url`、`rpc_addr`、`state`、`started_at`、`last_heartbeat_at`。
- `presence:user:{user_id}` 使用 Hash，字段包括 `user_id`、`node_id`、`connection_id`、`connected_at`、`last_heartbeat_at`、`access_token_expires_at`。
- `chat_nodes` 和 `presence` TTL 均为 30s，刷新间隔均为 10s。
- presence 刷新前必须确认最近 30s 内收到客户端 `heartbeat`。
- presence 续期必须校验 `connection_id`。
- presence 删除必须校验 `connection_id`。
- Redis presence 不能作为消息已送达或已读依据。
- refresh token 不能作为用户在线依据。
- `refresh_token_by_user:{user_id}` 不能作为用户在线依据。

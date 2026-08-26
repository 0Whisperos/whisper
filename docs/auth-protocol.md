# Auth 协议规范

本文档定义认证相关的 HTTP API、WebSocket auth 握手、token 模型、Redis refresh token 状态和错误码。本文档只描述认证协议和 token 生命周期；Redis presence 与节点路由见 `docs/redis-routing-presence.md`，消息与回执协议见 `docs/message-ack-protocol.md`。

## 总体原则

- 认证模型采用短期 JWT `access_token` 加长期随机 `refresh_token`。
- `access_token` 用于 HTTP API 鉴权和 WebSocket auth 握手。
- `refresh_token` 用于客户端下次启动免输入账号密码，直接换取新的 `access_token`。
- `refresh_token` 是 opaque token，不是 JWT。
- 服务端不保存 refresh token 明文，只保存 `refresh_token` hash。
- `refresh_token` 不轮换。`/v1/auth/refresh` 成功时只签发新的 `access_token`，不签发新的 `refresh_token`。
- `refresh_token` 只在主动退出登录、同一用户重新账号密码登录替换旧 token，或 Redis TTL 自然到期时失效。
- 关闭客户端、断网、崩溃、WebSocket 断开、`access_token` 过期，都不删除 `refresh_token`。
- WebSocket 在线状态和 refresh token 有效性互不等价。
- 所有时间文本使用 GB/T 7408 扩展格式，包含日期、时间和时区偏移，例如 `2026-08-16T12:15:00+08:00`。

## Token 模型

| Token | 形态 | 用途 | 保存位置 | 失效条件 |
| --- | --- | --- | --- | --- |
| `access_token` | 短期 JWT | 认证 HTTP API 请求和 WebSocket 连接 | 客户端内存；服务端不保存 | JWT `exp` 到期，或签名/claims 校验失败 |
| `refresh_token` | 长期随机 opaque token | 免输入账号密码换取新的 `access_token` | 客户端本地安全存储；服务端 Redis 保存 hash | 用户主动 logout 删除、同一用户重新账号密码登录替换，或 Redis TTL 自然到期 |

`access_token` 过期后，客户端应调用 `/v1/auth/refresh` 获取新的 `access_token`。如果 refresh token 仍有效，客户端不需要重新输入账号密码。

## JWT Claims

第一阶段 `access_token` JWT claims 保持最小。

```json
{
  "sub": "20001",
  "typ": "access",
  "iat": 1786862400,
  "exp": 1786863300
}
```

| Claim | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `sub` | `string` | 是 | 用户 ID，使用字符串形式保存。 |
| `typ` | `string` | 是 | Token 类型。第一阶段固定为 `access`。 |
| `iat` | `number` | 是 | JWT 签发时间，Unix 时间戳。 |
| `exp` | `number` | 是 | JWT 过期时间，Unix 时间戳。 |

第一阶段不引入 `jti`。如果后续需要单个 access token 撤销、审计或追踪，再单独扩展。

## Redis Refresh Token 状态

认证侧使用 `refresh_token:{token_hash}` 保存 refresh token 状态，并使用 `refresh_token_by_user:{user_id}` 记录当前用户最新 refresh token hash。两个 key 的边界已在 `docs/redis-routing-presence.md` 中定义；本文档只定义认证侧 value 字段和登录替换语义。

```json
{
  "user_id": "20001",
  "issued_at": "2026-08-16T12:00:00+08:00",
  "expires_at": "2026-09-15T12:00:00+08:00",
  "last_used_at": "2026-08-16T12:10:00+08:00"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `user_id` | `string` | 是 | refresh token 所属用户 ID。 |
| `issued_at` | `string` | 是 | refresh token 签发时间，使用 GB/T 7408 扩展格式。 |
| `expires_at` | `string` | 是 | refresh token 业务过期时间，使用 GB/T 7408 扩展格式，并应与 Redis TTL 对齐。 |
| `last_used_at` | `string` | 否 | 最近一次成功使用该 refresh token 调用 `/v1/auth/refresh` 的时间，使用 GB/T 7408 扩展格式。 |

Redis refresh token value 第一阶段不包含 `token_id` 和 `rotated_from`。refresh token 不轮换，因此不需要记录 token family 或来源 token。

`refresh_token_by_user:{user_id}` 的 value 是当前用户最新 refresh token hash。该索引用于同一用户重新账号密码登录时定位并删除旧 refresh token，也用于主动退出登录时确认是否需要清理用户索引。索引 TTL 应与对应的 `refresh_token:{token_hash}` 对齐。

## `POST /v1/auth/login`

### 用途

客户端使用账号密码登录。登录成功后，服务端签发新的 `access_token` 和新的 `refresh_token`，并返回一个可连接的 `im-chat` WebSocket 地址。

### 请求

```json
{
  "account": "00123456",
  "password": "password"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `account` | `string` | 是 | 登录账号。第一阶段沿用 8 到 12 位数字账号规则。 |
| `password` | `string` | 是 | 登录密码。 |

### 成功响应

```json
{
  "user_id": 20001,
  "access_token": "jwt-access-token",
  "refresh_token": "refresh-token",
  "access_token_expires_at": "2026-08-16T12:15:00+08:00",
  "im_chat_ws_url": "ws://127.0.0.1:9001/ws"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `user_id` | `number` | 是 | 当前登录用户 ID。 |
| `access_token` | `string` | 是 | 短期 JWT access token。 |
| `refresh_token` | `string` | 是 | 长期随机 opaque refresh token。客户端需要保存到本地安全存储。 |
| `access_token_expires_at` | `string` | 是 | access token 过期时间，使用 GB/T 7408 扩展格式。 |
| `im_chat_ws_url` | `string` | 是 | 客户端可连接的 `im-chat` WebSocket 地址。 |

### 处理语义

1. 校验账号和密码格式。
2. 校验账号密码是否正确。
3. 按 `user_id` 查找并删除同一用户旧的 refresh token 主记录和 `refresh_token_by_user:{user_id}` 索引。
4. 签发短期 JWT `access_token`。
5. 生成长期随机 `refresh_token`。
6. 计算 `refresh_token` hash，并写入 Redis `refresh_token:{token_hash}`，设置 TTL。
7. 写入 Redis `refresh_token_by_user:{user_id}`，value 为新的 refresh token hash，TTL 与主记录对齐。
8. 查询 Redis service registry，选择可用 `im-chat` 节点。
9. 返回 `user_id`、token 和 `im_chat_ws_url`。

## `POST /v1/auth/refresh`

### 用途

客户端使用本地保存的 `refresh_token` 免输入账号密码，换取新的短期 `access_token`。

### 请求

```json
{
  "refresh_token": "refresh-token"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `refresh_token` | `string` | 是 | 客户端本地保存的 refresh token 明文。 |

### 成功响应

```json
{
  "user_id": 20001,
  "access_token": "new-jwt-access-token",
  "access_token_expires_at": "2026-08-16T12:15:00+08:00",
  "im_chat_ws_url": "ws://127.0.0.1:9001/ws"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `user_id` | `number` | 是 | 当前 refresh token 所属用户 ID。 |
| `access_token` | `string` | 是 | 新签发的短期 JWT access token。 |
| `access_token_expires_at` | `string` | 是 | 新 access token 的过期时间，使用 GB/T 7408 扩展格式。 |
| `im_chat_ws_url` | `string` | 是 | 客户端可连接的 `im-chat` WebSocket 地址。 |

### 处理语义

1. 校验请求中存在 `refresh_token`。
2. 计算 `refresh_token` hash。
3. 查询 Redis `refresh_token:{token_hash}`。
4. key 不存在时，返回 `invalid_refresh_token` 或 `refresh_token_expired`。
5. key 存在时，读取 `user_id`。
6. 签发新的短期 JWT `access_token`。
7. 可更新 Redis value 中的 `last_used_at`。
8. 查询 Redis service registry，选择可用 `im-chat` 节点。
9. 返回 `user_id`、新的 `access_token`、过期时间和 `im_chat_ws_url`。

`/v1/auth/refresh` 成功后：

- 不返回新的 `refresh_token`。
- 不生成新的 `refresh_token`。
- 不删除旧 `refresh_token`。
- 不轮换 refresh token。
- 不因为 WebSocket 离线或在线状态改变 refresh token 有效性。

## `POST /v1/auth/logout`

### 用途

客户端主动退出登录。主动退出登录会删除服务端 Redis 中的 refresh token 状态，并要求客户端清理本地凭证。

### 请求

```json
{
  "refresh_token": "refresh-token"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `refresh_token` | `string` | 是 | 客户端本地保存的 refresh token 明文。服务端用它计算 hash，并删除对应 Redis 认证状态。 |

### 成功响应

```text
204 No Content
```

### 处理语义

1. 校验请求中存在 `refresh_token`。
2. 计算 `refresh_token` hash。
3. 删除 Redis `refresh_token:{token_hash}`。
4. 如果该 refresh token 仍是用户当前索引值，删除 Redis `refresh_token_by_user:{user_id}`。
5. 无论 key 是否已不存在，只要删除操作本身成功，都可以返回 `204 No Content`。
6. 客户端删除本地 `access_token` 和 `refresh_token`。
7. 客户端主动关闭 WebSocket；连接断开后的 presence 清理由 `docs/redis-routing-presence.md` 约束。

`/v1/auth/logout` 是主动退出语义。关闭客户端、断网、崩溃和 WebSocket 断开不是 logout，不删除 refresh token。

## WebSocket `auth`

### 用途

客户端连接 `im-chat` 后，第一条业务帧必须是 `auth`。认证通过前，服务端不处理其他业务消息。

### 请求

```json
{
  "type": "auth",
  "request_id": "req-uuid",
  "payload": {
    "access_token": "jwt-access-token"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `access_token` | `string` | 是 | 短期 JWT access token。 |

## WebSocket `auth_ok`

### 用途

`auth_ok` 表示 WebSocket 认证通过，连接已经绑定到用户身份。

### 响应

```json
{
  "type": "auth_ok",
  "request_id": "req-uuid",
  "payload": {
    "user_id": 20001,
    "connection_id": "connection-uuid",
    "access_token_expires_at": "2026-08-16T12:15:00+08:00"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `user_id` | `number` | 是 | 当前认证通过的用户 ID。 |
| `connection_id` | `string` | 是 | 当前 WebSocket 连接 ID，用于区分快速重连前后的新旧连接。 |
| `access_token_expires_at` | `string` | 是 | 当前 WebSocket 连接使用的 access token 过期时间，使用 GB/T 7408 扩展格式。 |

认证成功后，`im-chat` 写入本机 `ConnectionRegistry` 和 Redis presence。Redis presence 字段和 TTL 规则见 `docs/redis-routing-presence.md`。

## WebSocket `auth_failed`

### 用途

`auth_failed` 表示 WebSocket 认证失败。发送该响应后，服务端应关闭 WebSocket 连接。

### 响应

```json
{
  "type": "auth_failed",
  "request_id": "req-uuid",
  "payload": {
    "error_code": "token_expired",
    "message": "access token expired"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `error_code` | `string` | 是 | 稳定错误码。 |
| `message` | `string` | 是 | 面向调试的错误描述。客户端不应依赖该文本做业务判断。 |

如果错误码是 `token_expired`，客户端应调用 `/v1/auth/refresh` 获取新的 `access_token`，然后重新连接 WebSocket 并再次发送 `auth`。

## 生命周期与失效规则

| 场景 | `access_token` | `refresh_token` | WebSocket presence |
| --- | --- | --- | --- |
| 登录成功 | 签发新的短期 JWT | 删除同用户旧 token，签发新的随机 token，并写入 Redis 主记录和用户索引 | 不自动在线，客户端仍需连接 WebSocket 并 auth |
| `/v1/auth/refresh` 成功 | 签发新的短期 JWT | 保持原 token，不轮换、不删除 | 不自动在线，客户端仍需连接或重连 WebSocket |
| `/v1/auth/logout` 成功 | 客户端删除本地 token | 服务端删除 Redis 主记录，并在匹配时删除用户索引；客户端删除本地 token | 客户端应关闭 WebSocket；presence 由连接断开流程清理 |
| 关闭客户端 | 本地可清理内存中的 access token | 不删除 | WebSocket 离线，presence 清理或 TTL 过期 |
| 断网或崩溃 | access token 可能仍未过期，但不可用 | 不删除 | presence 依赖连接清理或 TTL 过期 |
| `access_token` 过期 | 失效 | 不受影响 | 连接侧按认证策略处理，客户端可 refresh 后重连 |
| Redis TTL 到期 | 不直接影响现有 access token | 失效 | 不影响 presence |

## 错误码清单

HTTP auth API 失败时统一返回错误响应体。客户端业务分支依赖 `error_code`，不依赖 `message` 文本。

```json
{
  "error_code": "invalid_credentials",
  "message": "account or password is incorrect"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `error_code` | `string` | 是 | 稳定错误码。客户端根据该字段处理错误分支。 |
| `message` | `string` | 是 | 面向调试的错误描述。客户端不应依赖该文本做业务判断。 |

### HTTP auth 错误码

| 错误码 | 适用接口 | 建议 HTTP 状态 | 含义 |
| --- | --- | --- | --- |
| `invalid_request` | 所有 auth HTTP API | `400` | 请求 JSON、字段缺失或字段格式非法。 |
| `invalid_credentials` | `/v1/auth/login` | `401` | 账号不存在或密码错误。 |
| `invalid_refresh_token` | `/v1/auth/refresh`、`/v1/auth/logout` | `401` | refresh token 格式非法、无法识别或已被主动删除。 |
| `refresh_token_expired` | `/v1/auth/refresh` | `401` | refresh token 已因 Redis TTL 到期失效。 |
| `no_available_chat_node` | `/v1/auth/login`、`/v1/auth/refresh` | `503` | 当前没有可用的 `im-chat` 节点。 |
| `internal_error` | 所有 auth HTTP API | `500` | 服务端内部错误。 |

HTTP 边界不返回内部错误细节。客户端业务分支依赖稳定错误码，不依赖人类可读错误文本。

### WebSocket auth 错误码

| 错误码 | 含义 |
| --- | --- |
| `invalid_request` | `auth` 帧缺失字段、payload 格式非法或不是连接后的第一条业务帧。 |
| `invalid_token` | access token 签名、claims、token 类型或用户身份校验失败。 |
| `token_expired` | access token 已过期。 |
| `internal_error` | 服务端内部错误。 |

## 实现检查清单

- `docs/auth-protocol.md` 不定义 Redis `presence` 或 `chat_nodes` 结构。
- `docs/auth-protocol.md` 不定义消息发送、实时推送、送达回执或已读回执协议。
- `/v1/auth/login` 返回 `user_id`、`access_token`、`refresh_token`、`access_token_expires_at`、`im_chat_ws_url`。
- `/v1/auth/refresh` 返回 `user_id`、`access_token`、`access_token_expires_at`、`im_chat_ws_url`，不返回 `refresh_token`。
- `/v1/auth/refresh` 不轮换 refresh token，不删除旧 refresh token。
- `/v1/auth/logout` 删除 Redis `refresh_token:{token_hash}`，并在索引匹配时删除 `refresh_token_by_user:{user_id}`。
- 同一用户重新账号密码登录会替换旧 refresh token。
- refresh token 只因 logout、同一用户重新账号密码登录替换，或 Redis TTL 到期失效。
- JWT claims 只包含 `sub`、`typ`、`iat`、`exp`。
- JWT claims 不包含 `jti`。
- Redis refresh token value 不包含 `token_id` 和 `rotated_from`。
- WebSocket `auth` 成功返回 `auth_ok`，失败返回 `auth_failed` 并关闭连接。
- WebSocket 在线状态和 refresh token 有效性互不等价。
- 所有时间文本使用 GB/T 7408 扩展格式。

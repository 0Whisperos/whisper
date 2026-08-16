# 消息与回执协议规范

本文档定义 WebSocket 上的消息发送、服务端确认、实时推送、送达回执和已读回执协议。本文档只描述线协议和语义边界；Redis 路由与在线状态见 `docs/redis-routing-presence.md`，MySQL 表结构见 `docs/database-schema.md`。

## 总体原则

- 业务消息只能在 WebSocket 认证成功后处理。认证握手本身不在本文档主体中定义。
- 所有客户端请求都必须携带 `request_id`，服务端响应必须原样返回对应的 `request_id`。
- 服务端主动推送可以不携带 `request_id`，因为它不是对某个客户端请求的直接响应。
- 所有时间文本使用 GB/T 7408 扩展格式，包含日期、时间和时区偏移，例如 `2026-08-16T12:00:01.123+08:00`。
- 第一阶段只支持 `message_type = "text"`，消息内容使用 `{ "text": "..." }`。
- `server_accepted` 只表示消息已经成功写入 MySQL，不表示 Kafka 已发布、对方已送达或用户已读。
- `message_created` 表示服务端正式时间线出现该消息。发送方也会收到该推送，用于合并本地临时消息。
- 送达和已读回执都采用单调推进语义。重复或较旧的游标不会回退服务端状态。

## 通用 WebSocket Envelope

所有 WebSocket JSON 帧都使用统一 envelope。

```json
{
  "type": "send_message",
  "request_id": "req-uuid",
  "payload": {}
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `type` | `string` | 是 | 帧类型。客户端和服务端根据该字段选择对应 payload 结构。 |
| `request_id` | `string` | 客户端请求必填；服务端主动推送可省略 | 请求 ID。客户端请求携带后，服务端响应必须原样返回，用于客户端匹配请求和响应。 |
| `payload` | `object` | 是 | 帧业务内容。不同 `type` 对应不同 payload 结构。 |

## 共享对象定义

### `Message`

`Message` 表示服务端正式消息对象。

```json
{
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "conversation_id": 10001,
  "conversation_seq": 42,
  "sender_user_id": 20001,
  "client_message_id": "1b7f4d2a-7d5c-47af-92f8-3bd2df4a2ad5",
  "message_type": "text",
  "content": {
    "text": "hello"
  },
  "created_at": "2026-08-16T12:00:01.123+08:00"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `message_id` | `string` | 是 | 服务端正式消息 ID。客户端按该字段去重、定位、引用消息。 |
| `conversation_id` | `number` | 是 | 消息所属会话 ID。 |
| `conversation_seq` | `number` | 是 | 消息在单个会话内的递增序号。客户端按它排序、发现缺口、推进送达和已读游标。 |
| `sender_user_id` | `number` | 是 | 发送者用户 ID。客户端用它判断消息方向和展示发送者信息。 |
| `client_message_id` | `string` | 是 | 发送方客户端生成的幂等 ID。发送方客户端可用它把正式消息和本地临时消息合并。 |
| `message_type` | `string` | 是 | 消息类型。第一阶段只支持 `text`。 |
| `content` | `object` | 是 | 消息内容。结构由 `message_type` 决定。 |
| `created_at` | `string` | 是 | 服务端创建正式消息的时间，使用 GB/T 7408 扩展格式。 |

### `TextMessageContent`

`TextMessageContent` 是 `message_type = "text"` 时的 `content` 结构。

```json
{
  "text": "hello"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `text` | `string` | 是 | 文本消息正文。长度和内容限制由服务端业务校验定义。 |

### `ErrorPayload`

`ErrorPayload` 是所有 rejected 帧共用的错误结构。

```json
{
  "error_code": "not_conversation_member",
  "message": "current user is not an active member of the conversation"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `error_code` | `string` | 是 | 稳定错误码。客户端应根据该字段处理错误分支。 |
| `message` | `string` | 是 | 面向调试的错误描述。客户端不应依赖该文本做业务判断。 |

## `send_message` 请求

客户端发送聊天消息时使用 `send_message`。

```json
{
  "type": "send_message",
  "request_id": "req-uuid",
  "payload": {
    "client_message_id": "1b7f4d2a-7d5c-47af-92f8-3bd2df4a2ad5",
    "conversation_id": 10001,
    "message_type": "text",
    "content": {
      "text": "hello"
    },
    "client_sent_at": "2026-08-16T12:00:00.000+08:00"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `client_message_id` | `string` | 是 | 客户端生成的发送幂等 ID。服务端按 `(sender_user_id, client_message_id)` 处理重试。 |
| `conversation_id` | `number` | 是 | 目标会话 ID。 |
| `message_type` | `string` | 是 | 消息类型。第一阶段只允许 `text`。 |
| `content` | `object` | 是 | 消息内容。第一阶段使用 `TextMessageContent`。 |
| `client_sent_at` | `string` | 否 | 客户端发送时间，使用 GB/T 7408 扩展格式。该字段只用于客户端体验或排查，不作为服务端排序依据。 |

## `server_accepted` 响应

服务端成功写入 `messages` 和 `outbox_events` 后，向发送方返回 `server_accepted`。

```json
{
  "type": "server_accepted",
  "request_id": "req-uuid",
  "payload": {
    "client_message_id": "1b7f4d2a-7d5c-47af-92f8-3bd2df4a2ad5",
    "message": {
      "message_id": "550e8400-e29b-41d4-a716-446655440000",
      "conversation_id": 10001,
      "conversation_seq": 42,
      "sender_user_id": 20001,
      "client_message_id": "1b7f4d2a-7d5c-47af-92f8-3bd2df4a2ad5",
      "message_type": "text",
      "content": {
        "text": "hello"
      },
      "created_at": "2026-08-16T12:00:01.123+08:00"
    }
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `client_message_id` | `string` | 是 | 客户端发送幂等 ID。客户端用它找到本地“发送中”的临时消息。 |
| `message` | `Message` | 是 | 服务端正式消息对象。 |

幂等重试时，如果服务端发现 `(sender_user_id, client_message_id)` 已经处理过，且 `conversation_id` 和内容哈希均一致，也返回同一个 `server_accepted` 结构。

## `send_message_rejected` 响应

服务端拒绝 `send_message` 时返回 `send_message_rejected`。

```json
{
  "type": "send_message_rejected",
  "request_id": "req-uuid",
  "payload": {
    "client_message_id": "1b7f4d2a-7d5c-47af-92f8-3bd2df4a2ad5",
    "error_code": "duplicate_client_message_conflict",
    "message": "client_message_id was reused with different content"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `client_message_id` | `string` | 请求中存在时必填 | 被拒绝的客户端发送幂等 ID。客户端用它定位本地临时消息。 |
| `error_code` | `string` | 是 | 稳定错误码。 |
| `message` | `string` | 是 | 面向调试的错误描述。 |

## `message_created` 推送

`message_created` 是服务端正式时间线事件推送。它来自 Kafka `message_created` 事件的在线投递，不表示客户端已经写入本地，也不表示用户已读。

```json
{
  "type": "message_created",
  "payload": {
    "event_id": "event-uuid",
    "message": {
      "message_id": "550e8400-e29b-41d4-a716-446655440000",
      "conversation_id": 10001,
      "conversation_seq": 42,
      "sender_user_id": 20001,
      "client_message_id": "1b7f4d2a-7d5c-47af-92f8-3bd2df4a2ad5",
      "message_type": "text",
      "content": {
        "text": "hello"
      },
      "created_at": "2026-08-16T12:00:01.123+08:00"
    }
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `event_id` | `string` | 是 | 领域事件 ID。客户端和服务端可用它排查问题；服务端 Consumer 用它做事件幂等。 |
| `message` | `Message` | 是 | 服务端正式消息对象。 |

发送方也会收到自己发送消息对应的 `message_created`。客户端应按 `message_id` 去重；如果本地尚无 `message_id`，则按 `client_message_id` 合并本地临时消息。

## `delivered_ack` 请求与响应

`delivered_ack` 表示客户端已经连续收到某个会话的消息到哪里。它确认的是消息到达客户端，不表示用户已经阅读。

### `delivered_ack` 请求

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

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `conversation_id` | `number` | 是 | 会话 ID。 |
| `delivered_seq` | `number` | 是 | 当前用户在该会话中已经连续收到的最大 `conversation_seq`。它不是用户自己发送的最后一条消息。 |

### `delivered_ack_accepted` 响应

服务端保存或确认送达游标后返回 `delivered_ack_accepted`。重复或较旧的 `delivered_seq` 也返回 accepted，并返回当前服务端保存后的游标值。

```json
{
  "type": "delivered_ack_accepted",
  "request_id": "req-uuid",
  "payload": {
    "conversation_id": 10001,
    "delivered_seq": 42,
    "delivered_at": "2026-08-16T12:00:02.000+08:00"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `conversation_id` | `number` | 是 | 会话 ID。 |
| `delivered_seq` | `number` | 是 | 服务端保存后的送达游标。该值不会小于服务端处理该请求前已保存的值。 |
| `delivered_at` | `string` | 是 | 服务端确认当前送达游标的时间，使用 GB/T 7408 扩展格式。 |

### `delivered_ack_rejected` 响应

服务端拒绝 `delivered_ack` 时返回 `delivered_ack_rejected`。

```json
{
  "type": "delivered_ack_rejected",
  "request_id": "req-uuid",
  "payload": {
    "conversation_id": 10001,
    "error_code": "cursor_out_of_range",
    "message": "delivered_seq is greater than the conversation last_seq"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `conversation_id` | `number` | 请求中存在时必填 | 被拒绝的会话 ID。 |
| `error_code` | `string` | 是 | 稳定错误码。 |
| `message` | `string` | 是 | 面向调试的错误描述。 |

## `read_ack` 请求与响应

`read_ack` 表示用户已经实际阅读到某个会话的哪个位置。它通常由客户端在用户打开会话、消息进入可视区域或停留满足产品规则后发送。

### `read_ack` 请求

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

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `conversation_id` | `number` | 是 | 会话 ID。 |
| `read_seq` | `number` | 是 | 当前用户在该会话中实际阅读到的最大 `conversation_seq`。 |

### `read_ack_accepted` 响应

服务端保存或确认已读游标后返回 `read_ack_accepted`。重复或较旧的 `read_seq` 也返回 accepted，并返回当前服务端保存后的游标值。

```json
{
  "type": "read_ack_accepted",
  "request_id": "req-uuid",
  "payload": {
    "conversation_id": 10001,
    "read_seq": 42,
    "read_at": "2026-08-16T12:00:03.000+08:00"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `conversation_id` | `number` | 是 | 会话 ID。 |
| `read_seq` | `number` | 是 | 服务端保存后的已读游标。该值不会小于服务端处理该请求前已保存的值。 |
| `read_at` | `string` | 是 | 服务端确认当前已读游标的时间，使用 GB/T 7408 扩展格式。 |

### `read_ack_rejected` 响应

服务端拒绝 `read_ack` 时返回 `read_ack_rejected`。

```json
{
  "type": "read_ack_rejected",
  "request_id": "req-uuid",
  "payload": {
    "conversation_id": 10001,
    "error_code": "cursor_out_of_range",
    "message": "read_seq is greater than the conversation last_seq"
  }
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `conversation_id` | `number` | 请求中存在时必填 | 被拒绝的会话 ID。 |
| `error_code` | `string` | 是 | 稳定错误码。 |
| `message` | `string` | 是 | 面向调试的错误描述。 |

## 幂等、排序、缺口和本地合并规则

### 发送幂等

- `send_message` 的幂等键为 `(sender_user_id, client_message_id)`。
- 如果同一幂等键已经存在，且 `conversation_id` 和规范化内容哈希一致，服务端返回已存在消息对应的 `server_accepted`。
- 如果同一幂等键已经存在，但 `conversation_id` 或规范化内容哈希不一致，服务端返回 `send_message_rejected`，错误码为 `duplicate_client_message_conflict`。
- `client_message_id` 不是正式消息 ID。正式消息 ID 是 `message_id`。

### 排序与缺口

- 客户端在同一 `conversation_id` 内按 `conversation_seq` 升序展示消息。
- 客户端发现 `conversation_seq` 不连续时，不应推进连续送达游标。
- 客户端补齐缺失消息后，再按连续收到的最大 `conversation_seq` 上报 `delivered_ack`。

### 本地合并

- 收到 `server_accepted` 时，发送方客户端按 `client_message_id` 找到本地临时消息，并补齐 `message_id`、`conversation_seq`、`created_at` 等服务端字段。
- 收到 `message_created` 时，客户端先按 `message_id` 去重。
- 如果 `message_id` 不存在，但 `client_message_id` 命中本地临时消息，客户端应合并该本地消息，不新增重复气泡。
- 如果 `message_id` 和 `client_message_id` 都没有命中本地消息，客户端再插入新消息。

### 回执单调推进

- `delivered_seq` 更新语义为 `GREATEST(existing.delivered_seq, incoming.delivered_seq)`。
- `read_seq` 更新语义为 `GREATEST(existing.read_seq, incoming.read_seq)`。
- 服务端 accepted 响应返回当前保存后的游标值，客户端以响应值为准。

## 错误码清单

| 错误码 | 适用帧 | 含义 |
| --- | --- | --- |
| `unauthenticated` | 所有业务请求 | 当前 WebSocket 连接未认证或认证已失效。 |
| `invalid_message` | 所有业务请求 | 请求 JSON、`type`、`request_id`、`payload` 或业务字段格式非法。 |
| `conversation_not_found` | `send_message`、`delivered_ack`、`read_ack` | 会话不存在。 |
| `not_conversation_member` | `send_message`、`delivered_ack`、`read_ack` | 当前用户不是该会话的有效成员。 |
| `duplicate_client_message_conflict` | `send_message` | 同一 `client_message_id` 被复用于不同会话或不同内容。 |
| `cursor_out_of_range` | `delivered_ack`、`read_ack` | 上报游标超过服务端已知的会话最大序号，或不符合服务端游标规则。 |
| `internal_error` | 所有业务请求 | 服务端内部错误。 |

## 实现检查清单

- 所有客户端请求都携带 `request_id`。
- 所有请求响应都原样返回 `request_id`。
- `send_message` 成功返回 `server_accepted`，失败返回 `send_message_rejected`。
- `delivered_ack` 成功返回 `delivered_ack_accepted`，失败返回 `delivered_ack_rejected`。
- `read_ack` 成功返回 `read_ack_accepted`，失败返回 `read_ack_rejected`。
- `message_created` 是服务端主动推送，可以不携带 `request_id`。
- 发送方也会收到自己的 `message_created`，客户端必须合并而不是重复展示。
- `delivered_seq` 表示连续收到进度，不表示用户自己发送的最后一条消息。
- `read_seq` 表示实际阅读进度，不表示送达。
- 所有时间文本使用 GB/T 7408 扩展格式。
- 本文档不定义 Redis `presence`、`chat_nodes` 的 key 结构。

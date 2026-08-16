# Kafka Outbox 与 Event Envelope 结构规范

本文档定义第一阶段 Kafka Outbox 事件的结构、字段含义和映射关系。MySQL 表结构见 `docs/database-schema.md`，WebSocket 消息与回执协议见 `docs/message-ack-protocol.md`，Redis 路由与在线状态见 `docs/redis-routing-presence.md`。

## 总体约定

- 第一阶段 Kafka 只承载聊天消息创建后的实时分发事件。
- 第一阶段只定义 `message_created v1`。
- Kafka value 使用 JSON event envelope，不引入 Avro、Protobuf 或 Schema Registry。
- Kafka payload 中的时间文本使用 GB/T 7408 扩展格式，包含日期、时间和时区偏移，例如 `2026-08-16T12:00:01.123+08:00`。
- `outbox_events` 是 append-only 事件发布表，不维护 `pending`、`publishing`、`published` 等发布状态。
- Kafka 不是聊天历史事实来源，也不是离线收件箱；聊天历史和离线补齐以 MySQL `messages` 为准。

## Kafka Record 结构

Consumer 从 Kafka 中读取的是完整 record。第一阶段 record 结构如下：

```json
{
  "topic": "whisper.chat.message-events.v1",
  "key": "10001",
  "headers": {
    "event_id": "event-uuid",
    "event_type": "message_created",
    "aggregate_type": "chat_message"
  },
  "value": {
    "event_id": "event-uuid",
    "event_type": "message_created",
    "aggregate_type": "chat_message",
    "aggregate_id": "10001",
    "event_version": 1,
    "occurred_at": "2026-08-16T12:00:01.123+08:00",
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

| 字段名 | 类型 | 是否必填 | 固定值/来源 | 字段含义 |
| --- | --- | --- | --- | --- |
| `topic` | `string` | 是 | 固定为 `whisper.chat.message-events.v1` | Kafka topic 名称。第一阶段所有聊天消息事件都写入该 topic。 |
| `key` | `string` | 是 | `outbox_events.aggregateid` | Kafka record key。第一阶段使用 `conversation_id` 的字符串形式，使同一会话事件进入同一分区。 |
| `headers` | `KafkaHeaders` | 是 | 由 outbox 行字段映射得到 | Kafka record headers。保存轻量事件元信息，用于快速判断事件类型和做事件幂等。 |
| `value` | `EventEnvelope` | 是 | `outbox_events.payload` | Kafka record value。保存完整业务事件结构，是 Consumer 解析业务内容的主要来源。 |

## KafkaHeaders 结构

```json
{
  "event_id": "event-uuid",
  "event_type": "message_created",
  "aggregate_type": "chat_message"
}
```

| 字段名 | 类型 | 是否必填 | 固定值/来源 | 字段含义 |
| --- | --- | --- | --- | --- |
| `event_id` | `string` | 是 | `outbox_events.id` | 事件 ID。Consumer 可用它做幂等去重；必须与 `value.event_id` 相同。 |
| `event_type` | `string` | 是 | `outbox_events.type` | 事件类型。第一阶段固定为 `message_created`；必须与 `value.event_type` 相同。 |
| `aggregate_type` | `string` | 是 | `outbox_events.aggregatetype` | 聚合类型。第一阶段固定为 `chat_message`；必须与 `value.aggregate_type` 相同。 |

Headers 不是完整业务正文。Consumer 可以先读 headers 做快速判断，但业务处理必须以 `value` 中的完整 event envelope 为准。

## EventEnvelope 结构

`EventEnvelope` 是 Kafka value 的顶层结构。第一阶段直接来自 `outbox_events.payload`。

```json
{
  "event_id": "event-uuid",
  "event_type": "message_created",
  "aggregate_type": "chat_message",
  "aggregate_id": "10001",
  "event_version": 1,
  "occurred_at": "2026-08-16T12:00:01.123+08:00",
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
```

| 字段名 | 类型 | 是否必填 | 固定值/来源 | 字段含义 |
| --- | --- | --- | --- | --- |
| `event_id` | `string` | 是 | `outbox_events.id` | 领域事件 ID。全局唯一，用于 Consumer 幂等、日志关联和问题排查。 |
| `event_type` | `string` | 是 | `outbox_events.type` | 领域事件类型。第一阶段固定为 `message_created`。 |
| `aggregate_type` | `string` | 是 | `outbox_events.aggregatetype` | 事件所属聚合类型。第一阶段固定为 `chat_message`。 |
| `aggregate_id` | `string` | 是 | `outbox_events.aggregateid` | 事件所属聚合 ID。第一阶段为 `conversation_id` 的字符串形式。 |
| `event_version` | `number` | 是 | 固定为 `1` | 事件结构版本。第一阶段固定为 `1`，用于后续事件结构演进。 |
| `occurred_at` | `string` | 是 | 服务端事件发生时间 | 领域事件发生时间。通常与写入 `outbox_events.created_at` 的时间一致，使用 GB/T 7408 扩展格式。 |
| `message` | `Message` | 是 | `messages` 中的正式消息事实 | 服务端正式消息对象。字段结构与 `docs/message-ack-protocol.md` 中的 `Message` 保持一致。 |

## Message 字段引用

`message` 字段复用 `docs/message-ack-protocol.md` 中定义的 `Message` 结构。为避免实现时误解，本文列出该结构在 Kafka event envelope 中的字段含义。

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `message_id` | `string` | 是 | 服务端正式消息 ID。Consumer 和客户端可用它做消息去重、定位和日志关联。 |
| `conversation_id` | `number` | 是 | 消息所属会话 ID。必须与 `EventEnvelope.aggregate_id` 表示同一个会话。 |
| `conversation_seq` | `number` | 是 | 消息在单个会话内的递增序号。客户端按它排序、发现缺口并推进送达或已读游标。 |
| `sender_user_id` | `number` | 是 | 发送者用户 ID。客户端用它判断消息方向和展示发送者信息。 |
| `client_message_id` | `string` | 是 | 发送方客户端生成的发送幂等 ID。发送方客户端可用它把正式消息和本地临时消息合并。 |
| `message_type` | `string` | 是 | 消息类型。第一阶段固定为 `text`。 |
| `content` | `TextMessageContent` | 是 | 消息内容。第一阶段文本消息使用 `{ "text": "..." }`。 |
| `created_at` | `string` | 是 | 服务端创建正式消息的时间，使用 GB/T 7408 扩展格式。 |

## TextMessageContent 结构

```json
{
  "text": "hello"
}
```

| 字段名 | 类型 | 是否必填 | 字段含义 |
| --- | --- | --- | --- |
| `text` | `string` | 是 | 文本消息正文。长度和内容限制由服务端业务校验定义。 |

## `message_created v1` 常量

| 名称 | 值 | 字段含义 |
| --- | --- | --- |
| Kafka topic | `whisper.chat.message-events.v1` | 第一阶段聊天消息事件所在 topic。 |
| Kafka key | `String(message.conversation_id)` | Kafka record 分区键。与 `outbox_events.aggregateid`、`value.aggregate_id` 相同。 |
| `event_type` | `message_created` | 表示服务端正式时间线出现一条新消息。 |
| `aggregate_type` | `chat_message` | 表示该事件属于聊天消息聚合。 |
| `event_version` | `1` | 第一阶段事件结构版本。 |

## Outbox 到 Kafka 映射

`outbox_events` 表的 DDL 和字段说明由 `docs/database-schema.md` 定义。本文只定义 outbox 行如何映射成 Kafka record。

| Outbox 字段 | Kafka 目标 | 字段含义 |
| --- | --- | --- |
| `outbox_events.id` | `headers.event_id`、`value.event_id` | 事件 ID。用于 Consumer 幂等和日志关联。 |
| `outbox_events.aggregatetype` | `headers.aggregate_type`、`value.aggregate_type` | 聚合类型。第一阶段为 `chat_message`。 |
| `outbox_events.aggregateid` | `record.key`、`value.aggregate_id` | 聚合 ID。第一阶段为 `conversation_id` 的字符串形式。 |
| `outbox_events.type` | `headers.event_type`、`value.event_type` | 事件类型。第一阶段为 `message_created`。 |
| `outbox_events.payload` | `record.value` | 完整 event envelope JSON。 |
| `outbox_events.created_at` | `value.occurred_at` | 事件发生时间的数据库存储值；输出到 Kafka payload 时使用 GB/T 7408 扩展格式。 |

一致性约束：

| 约束 | 字段含义 |
| --- | --- |
| `outbox_events.id == value.event_id` | 确保 outbox 主键和事件正文中的事件 ID 一致。 |
| `outbox_events.aggregatetype == value.aggregate_type` | 确保 outbox 聚合类型和事件正文聚合类型一致。 |
| `outbox_events.aggregateid == value.aggregate_id` | 确保 outbox 聚合 ID 和事件正文聚合 ID 一致。 |
| `outbox_events.type == value.event_type` | 确保 outbox 事件类型和事件正文事件类型一致。 |
| `record.key == value.aggregate_id` | 确保 Kafka 分区键和事件聚合 ID 一致。 |
| `value.aggregate_id == String(value.message.conversation_id)` | 确保事件聚合 ID 指向消息所属会话。 |
| `value.event_version == 1` | 确保第一阶段 Consumer 按 v1 结构解析。 |

## 可靠性语义

| 语义 | 说明 |
| --- | --- |
| `server_accepted` | 只表示 MySQL 事务提交成功，不表示 Kafka 已发布，也不表示客户端已收到。 |
| Kafka record 写入成功 | 只表示事件进入实时分发链路，不表示客户端已收到。 |
| 送达 | 不由 Kafka 表示；由 `delivered_ack` 和 `conversation_member_cursors.delivered_seq` 表示。 |
| 已读 | 不由 Kafka 表示；由 `read_ack` 和 `conversation_member_cursors.read_seq` 表示。 |
| 离线消息 | 不由 Kafka 保存；离线补齐查询 MySQL `messages`。 |
| 事件重复 | CDC、Kafka 或 Consumer 重试都可能产生重复事件，Consumer 必须按 `event_id` 幂等。 |
| 消息重复 | 客户端必须按 `message_id` 做消息去重。 |
| 顺序 | Kafka 不保证 topic 全局顺序；同一 `conversation_id` 使用同一个 key，使同一会话事件进入同一分区。 |
| 未知事件 | Consumer 遇到未知 `event_type` 时，不应按 `message_created` 处理。 |

## 不属于本文档的内容

- 不定义 MySQL 全量 DDL。
- 不重复 `messages`、`conversations`、`conversation_members`、`conversation_member_cursors` 表结构。
- 不重复 WebSocket `send_message`、`server_accepted`、`message_created`、`delivered_ack`、`read_ack` 协议。
- 不重复 Redis `presence:user:{user_id}`、`chat_nodes:{node_id}` 的 key 结构。
- 不定义认证、refresh token、登录或退出登录协议。
- 不定义 Debezium Connector、Outbox Event Router、Kafka Connect 的完整部署配置。
- 不定义 DLQ 策略、跨节点 RPC 投递协议或通用后台任务调度。

## 实现检查清单

- 第一阶段只发布 `message_created v1`。
- Kafka record 已定义 `topic`、`key`、`headers`、`value`，且每个字段都有含义说明。
- `KafkaHeaders` 已定义 `event_id`、`event_type`、`aggregate_type`，且每个字段都有含义说明。
- `EventEnvelope` 已定义 `event_id`、`event_type`、`aggregate_type`、`aggregate_id`、`event_version`、`occurred_at`、`message`，且每个字段都有含义说明。
- `message` 字段复用 `docs/message-ack-protocol.md` 中的 `Message` 结构。
- `occurred_at` 使用 GB/T 7408 扩展格式。
- Outbox 到 Kafka 映射关系已覆盖 `id`、`aggregatetype`、`aggregateid`、`type`、`payload`、`created_at`。
- Kafka 不表示送达或已读。
- Kafka 不是离线收件箱。
- Consumer 按 `event_id` 做幂等。
- 客户端按 `message_id` 做消息去重。
- 本文档不重复定义 Redis `presence`、`chat_nodes` key 结构。
- 本文档不重复展开 WebSocket 消息发送、服务端确认、送达回执和已读回执协议。

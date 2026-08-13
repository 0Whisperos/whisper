# 发送消息的理解

如果采用 CDC Outbox 策略，客户端发送消息时先生成 `client_message_id`，用于服务端识别同一次发送请求并保证幂等。`im-chat` 收到消息后，在同一个 MySQL 事务中完成身份校验、会话权限校验、内容校验、会话序号分配、消息落库和 Outbox 事件写入。

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

## 第二阶段：服务端事务写入消息和 Outbox

`im-chat` 收到消息后，开启一个 MySQL 事务，在事务中完成：

1. 校验访问令牌对应的用户身份。
2. 校验发送者是否属于该会话。
3. 校验消息类型、长度和内容。
4. 根据 `(sender_user_id, client_message_id)` 做幂等检查；如果已经处理过，直接返回已存在的 `message_id` 和 `conversation_seq`。
5. 锁定 `conversations` 中对应会话行，读取并递增 `last_seq`。
6. 生成服务端正式 `message_id`。
7. 向 `messages` 表写入消息事实，包括 `message_id`、`conversation_id`、`conversation_seq`、`sender_user_id`、消息内容和创建时间。
8. 向 `outbox_events` 表插入一条 `message_created` 事件，包括 `event_id`、`aggregate_type`、`aggregate_id`、`event_type`、`partition_key`、`payload` 和 `created_at`。

这两个核心写入必须在同一个本地事务中完成：

```text
messages       保存正式聊天历史
outbox_events  保存待发布领域事件
```

只要事务提交成功，消息就已经成为正式历史。即使 Kafka、Debezium 或网络暂时不可用，消息也不会丢；CDC 恢复后可以继续从 binlog 推进。

## 第三阶段：CDC 将 Outbox 事件发布到 Kafka

采用 CDC 后，不再由 `im-chat` 扫描 `outbox_events`。推荐流程是：

1. MySQL 开启 row-based binlog。
2. Debezium MySQL Connector 读取 binlog。
3. Connector 只捕获 `outbox_events` 表的新增事件。
4. Debezium Outbox Event Router 把 outbox 行转换为 Kafka 消息。
5. Kafka Connect 保存 connector offset，用于故障恢复后继续读取。

这种方式避免了多个 `im-chat` 实例并发扫描、加锁、抢占 `pending` 事件的问题。`outbox_events` 可以按 append-only 事件表设计，通常只插入，不依赖 `pending -> publishing -> published` 这类应用层状态迁移。

需要注意的是，CDC 方案把可靠性要求转移到了基础设施：

1. MySQL binlog 保留时间必须大于 CDC 最长故障恢复时间。
2. Debezium/Kafka Connect 的 offset topic 必须可靠保存。
3. Kafka topic 需要合理设置副本、ISR 和 producer ack 策略。
4. CDC 可能产生重复事件，下游 Consumer 和客户端仍然必须幂等。
5. `outbox_events` 已发布的历史记录仍然需要定期归档或清理，但清理不能早于 CDC 已确认消费的位置。

## 第四阶段：Kafka 保存实时分发事件

Kafka 保存的是实时分发事件，不是聊天历史的唯一来源。聊天历史事实仍然以 MySQL `messages` 表为准。

Kafka topic 的分区键应优先考虑 `conversation_id`，这样同一个会话内的 `message_created` 事件进入同一分区，有利于保持会话内顺序。实际分区键、topic 规划、consumer group 规划还需要后续专项设计。

Kafka 写入成功不表示客户端已经收到消息。它只表示事件进入实时分发链路。

## 第五阶段：Consumer 投递在线连接

`im-chat` 的 Kafka Consumer 消费 `message_created` 事件后：

1. 根据 `event_id` 或 `message_id` 做幂等检查。
2. 根据 `conversation_id` 查询会话成员。
3. 查询这些成员当前在线的 WebSocket 连接。
4. 如果接收方在线，通过 WebSocket 推送消息。
5. 如果接收方离线，本次实时投递结束，不推进 `delivered_seq`。
6. 完成本次投递决策后提交 Kafka offset。

如果第一阶段只支持单设备在线，可以先维护 `user_id -> connection` 的在线连接关系。未来支持多设备时，需要改为 `user_id -> device_id -> connection`，并把同一账号其他在线设备也纳入同步范围。

## 第六阶段：客户端接收、去重和回执

客户端收到服务端推送的 `message_created` 后：

1. 使用 `message_id` 去重，避免重复推送导致重复展示。
2. 使用 `conversation_seq` 在会话内排序。
3. 如果发现 `conversation_seq` 有缺口，向服务端补拉缺失消息。
4. 连续收到消息后，向服务端发送 `delivered_ack`，推进 `delivered_seq`。
5. 用户真正阅读后，发送 `read_ack`，推进 `read_seq`。

`delivered_seq` 和 `read_seq` 不应混用：

```text
delivered_seq  客户端确认连续收到到哪里
read_seq       用户确认阅读到哪里
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
6. 第一阶段是单设备在线，还是直接支持多设备在线同步。

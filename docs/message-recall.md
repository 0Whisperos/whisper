# 消息撤回

本轮撤回采用状态持久化与客户端展示变化：仅有效会话成员中的原发送者可以撤回自己的正式消息，不限制时间。数据库和接口保留原正文、图片信息及引用关系；不删除附件、不清理图片缓存，也不修改附件下载授权。

## 数据与事务

`messages.recalled_at` 是 nullable `DATETIME(6)`，为空表示正常，非空表示已经撤回。沿用 `im-api migrate` / GORM `AutoMigrate` 增加字段，旧记录无需回填；不新增表、索引或 `recalled_by_user_id`。

```sql
ALTER TABLE messages ADD COLUMN recalled_at DATETIME(6) NULL DEFAULT NULL;
```

客户端通过已认证 WebSocket 向 `im-chat` 发起撤回。服务端在事务中锁定目标消息，验证有效成员和原发送者，首次撤回时更新 `recalled_at` 并插入一条 `message_recalled` outbox。重复请求返回首次撤回时间，不重复生成事件；事务失败时两项写入一起回滚。成功响应在事务提交后发送，不等待 Kafka 或对方客户端。

原 `message_id`、`conversation_seq`、正文、内容哈希、回复关系、会话 `last_seq` 和成员游标均保持不变。原消息被撤回后，仍允许发送引用该消息的新回复。

## WebSocket

请求与响应遵循现有 envelope；请求必须携带 `request_id`，响应原样返回。

```json
{
  "type": "recall_message",
  "request_id": "request-uuid",
  "payload": { "message_id": "550e8400-e29b-41d4-a716-446655440000" }
}
```

`recall_message_accepted.payload` 包含 `message_id`、`conversation_id`、`conversation_seq`、`sender_user_id`、`recalled_at`。时间沿用已有协议格式，包含时区。

`recall_message_rejected.payload` 包含可取得的 `message_id`、`error_code` 和 `message`。错误码为 `invalid_message_id`、`message_not_found`、`message_not_owned`、`internal_error`；不存在及对当前用户不可见统一使用 `message_not_found`。客户端按错误码处理，不依赖说明文本。

`message_recalled` 是主动推送，不携带请求 ID；payload 在成功响应的状态字段之外增加 `event_id`。该事件只是已有消息的状态变化，不新增气泡，不推进消息或回执游标。

正式消息 DTO 和浅层 `reply_to` 都增加 `recalled_at: string | null`。旧响应缺少字段时按空处理。`content` 保持原结构，不改成 `null`，也不引入 `recalled`、服务端 `summary` 或递归引用。

## Outbox、Kafka 与节点投递

继续使用 topic `whisper.chat.message-events.v1` 和现有消费组。两类事件的 key 都是会话 ID 字符串；同一分区内按 Kafka 写入顺序消费。创建事件仍为 `message_created v1`，撤回为 `message_recalled v1`。

```json
{
  "event_id": "event-uuid",
  "event_type": "message_recalled",
  "aggregate_type": "chat_message",
  "aggregate_id": "10001",
  "event_version": 1,
  "occurred_at": "2026-10-23T12:00:00.123456+08:00",
  "recalled_message": {
    "message_id": "550e8400-e29b-41d4-a716-446655440000",
    "conversation_id": 10001,
    "conversation_seq": 42,
    "sender_user_id": 20001,
    "recalled_at": "2026-10-23T12:00:00.123456+08:00"
  }
}
```

两种事件共用 envelope、key/header 校验、事件完成标记和 offset 提交机制，按 `event_type` 分发。同节点向对应连接入队，跨节点通过签名保护的内部 HTTP RPC 通知连接所属节点；离线用户跳过实时通知。

创建事件投递前补读消息自身及引用目标的当前撤回状态。旧创建事件即使重放，也仍返回原消息正文与原序号，并附最新 `recalled_at`，客户端据此显示占位；不能因为消息已经撤回而跳过该创建记录，否则首次接收者会缺少连续序号。

事件先查询当前有效成员；没有有效接收成员时完成本次投递决策，不再补读消息。存在成员时，消息或引用状态查询失败仍会重试，不推进 offset，避免把存储故障误当作已完成投递。

消费确认保持现有顺序：Redis 查询完成标记 → 投递决策 → 写 Redis 完成标记（7 天）→ 同步提交当前分区 `offset + 1`。它不等待客户端 ACK。RPC 或连接队列失败仍按现有 best effort 行为处理；Kafka 记录仍存在不代表重启后一定重推，已经完成或提交的事件会跳过。漏通知通过下述状态校准补齐。

## 批量状态校准

```http
POST /v1/conversations/{conversation_id}/messages/statuses
Authorization: Bearer <access-token>

{"message_ids":["550e8400-e29b-41d4-a716-446655440000"]}
```

```json
{
  "statuses": [
    {
      "message_id": "550e8400-e29b-41d4-a716-446655440000",
      "recalled_at": "2026-10-23T12:00:00.123456+08:00"
    }
  ]
}
```

要求当前用户是该 direct 会话有效成员；状态读取不要求用户为发送者。原数组限制为 1～100 个合法 UUID，内部去重，按首次出现顺序返回。不存在或跨会话 ID 省略；非法请求返回 `invalid_message_status_request`。省略项只表示未知，不能当成未撤回。

接口用于修复已经加载但漏掉实时通知的消息。每次 WebSocket 实际认证成功后，等待聊天数据就绪，按会话收集内存正式消息、引用和草稿目标，去重分批校准；期间新增 ID 补查。失败保留展示并可重试，手动重试历史也执行校准。不新增一般断网自动重连，不扫描尚未加载的全部历史。

## 客户端显示与合并

- 仅本人 `accepted`、有正式 ID 且尚未撤回的消息提供撤回入口；pending、失败和超时独立于原消息发送状态，确认超时为 15 秒。
- 成功响应、实时事件或状态查询确认后，在原位置显示“你撤回了一条消息”或“某某撤回了一条消息”。关闭该消息菜单并隐藏正文、图片、回执和自身引用，保留底层数据及缓存。
- 相关回复和草稿引用显示“该消息已撤回”，保留回复正文及引用 ID，仍允许提交回复。
- 会话预览使用撤回提示；查看器移除对应图片，选择下一张、上一张或关闭空列表，不等待其他图片下载。不新增在途复制、保存取消机制。
- 尚未取得完整正文和图片的转发任务在收到撤回状态后停止；已持有完整独立副本的任务继续上传、重试和发送，不级联撤回副本。

历史、创建、发送确认、撤回确认、实时事件和状态查询共用单调合并：已知非空撤回时间不能被迟到的空值覆盖。状态按服务地址、账号、会话和消息 ID 隔离，凭证续期和历史重载不清空，切换账号时清空。

收到尚未加载消息的撤回事件时，只记录轻量状态；不插入历史占位、不跳转、不发起历史查询，也不推进游标。将来加载原消息时，在其原序号位置显示占位。这个记录也防止撤回先到、旧历史响应后到时重新显示正文。

## 发布与验证

先迁移 nullable 字段，再升级全部事件消费者和 RPC 接收节点，最后发布撤回服务端与客户端入口。旧消费者会跳过并提交不支持的事件，不能在节点兼容前开始产生撤回事件。当前构建没有撤回生产开关；分阶段滚动发布需要另行准备只读取新事件的兼容构建，或通过维护窗口统一升级。回滚时保留新增列及新事件的读取支持。

开启撤回前还必须完成接收端客户端升级并排空旧版连接：旧客户端不识别 `message_recalled`，收到后会关闭 WebSocket，也不会显示撤回。当前没有客户端能力协商或最低版本门槛，不能直接混用旧版接收端。

自动化测试覆盖事务原子性、权限、重复和并发、正文保留、两类事件/节点投递、确认顺序、乱序合并、未加载历史、状态批查、回复仍可发送、转发和查看器。数据库与真实 CDC 验收必须使用专用测试库和隔离资源；普通单元测试通过不代表真实链路验收完成。

### 本轮验证记录（2026-10-24）

- `im-api`：启用 CGO 和实际 GCC 后，`go test ./...`、`go vet ./...` 通过，包含 SQLite 持久化与迁移测试。真实 MySQL 新增字段只在独立测试库验证，未迁移业务库。
- `im-chat`：设置隔离依赖环境变量后，`cargo test --offline --lib -- --include-ignored --test-threads=1`，128 项通过、0 项跳过；`cargo test --offline --test cdc_delivery -- --include-ignored --test-threads=1`，5 项通过、0 项跳过，其中四项运行真实 MySQL → Debezium → Kafka → WebSocket 单双节点链路，一项验证 nullable 引用的 CDC 比较边界。最终构建、`cargo fmt -- --check` 通过；Clippy 通过，仍报告六项既有函数参数过多警告。
- `im-client`：`npm test -- --reporter=dot`，74 个文件、514 项测试全部通过；`npm run build -- --outDir .tmp/message-recall-build` 通过，包含 TypeScript 检查。账号或服务地址切换时，旧连接在 effect 清理前回调的两个回归场景均先复现失败再验证修复。
- 真实 HTTP/WebSocket 业务验收：在隔离 MySQL、Redis、Kafka、Debezium 与测试节点上，六组场景全部通过，覆盖注册登录与双客户端连接、非法/越权撤回、大小写 ID 及重复撤回、双方 CDC 通知及游标不变、状态批查权限与去重、撤回后回复和页外引用原文保留，以及离线重连状态补查。
- Windows 原生 WebView2 的人工桌面验收尚未执行；上述结果不代表原生窗口人工验收通过。

### 测试清理记录（2026-10-26）

按需求删除 `im-api` 中依赖 SQLite 的十项测试及辅助代码，移除 SQLite 驱动依赖；保留不依赖 SQLite 的 schema、服务和 HTTP 测试。清理后以 `CGO_ENABLED=0` 执行 `go test ./...`、`go vet ./...` 均通过。上面的 2026-10-24 记录是清理前的历史验证结果。

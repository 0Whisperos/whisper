# 聊天图片消息流程

本文定义文字与多张图片按编辑顺序组成一条聊天消息时，客户端、`im-api`、`im-chat` 与 OSS 之间的接口和生命周期。当前代码已支持附件授权、富文本图片消息发送与展示；附件清理任务等运维流程仍待补充。现有文本发送、确认、实时投递和历史补齐的基础语义见 [消息与回执协议](message-ack-protocol.md)。

## 设计约定

- 一条消息由有序 `blocks` 组成；文字块和图片块可任意交错，数组顺序就是编辑器中的显示顺序。
- 图片数据由 `im-client` 直接上传至私有 OSS。聊天消息只保存服务端生成的 `attachment_id`，不保存 OSS key 或临时 URL。
- 每张图片对应一个 OSS 对象和一个上传 URL；下载也按对象签发 URL。客户端通过批量 API 一次申请多张图片的授权。
- `im-api` 与 `im-chat` 连接同一个 MySQL schema。`im-api` 创建、更新附件记录；`im-chat` 在接受消息时校验并关联附件。
- 首版允许 JPEG、PNG、WebP，不允许 SVG；每条消息最多 10 张图，单张不超过 20 MiB，图片总量不超过 50 MiB。
- 上传完成校验只检查 OSS 对象存在和实际大小，不读取或解码图片正文。因此 `uploaded` 表示对象已到 OSS 且大小符合限制，不表示服务端确认了文件实际格式。
- 上传后沿用原 OSS key，不执行头像流程中的完整下载、复制到新 key 和删除临时 key。

## 附件记录

新增 `attachments` 表保存上传状态及 OSS 对象的服务端映射。字段如下：

| 字段 | 用途 |
| --- | --- |
| `attachment_id` | 服务端生成的 UUID，主键，也是消息内容引用的 ID。 |
| `uploader_user_id` | 上传者，用于发送校验。 |
| `conversation_id` | 上传授权绑定的会话。 |
| `object_key` | 服务端生成的 OSS key；只由服务端使用，不放进消息内容或下载响应。 |
| `file_name` | 原始文件名，展示或下载时使用；不能作为存储 key。 |
| `content_type` | 上传授权采用的类型，仅为客户端声明的媒体类型，不代表已验证文件内容。 |
| `size_bytes` | 上传完成检查后记录的 OSS 实际对象大小。 |
| `status` | `uploading`、`uploaded`、`attached` 或 `expired`。 |
| `message_id` | 状态为 `attached` 时关联的正式消息 ID；其他状态为空。 |
| `expires_at` | 未完成/未关联附件的清理期限。 |
| `created_at`、`updated_at` | 创建与状态更新时间。 |

`attachment_id` 是附件记录的主键，不是 OSS key。消息 JSON 保存附件 ID，服务端再通过附件记录定位对象。`uploading` 和超期的 `uploaded` 记录及其对象由清理任务回收；已关联附件的保留期限跟随消息数据策略。

状态流转规则：`uploading` 在对象元数据检查通过后变为 `uploaded`；`uploaded` 在消息事务提交时变为 `attached`。未完成附件过期后变为 `expired` 并删除 OSS 对象；`uploaded` 附件若始终未关联消息，也在其关联期限到期后变为 `expired`。`attached` 不回退到 `uploaded`。

## 新增 im-api 接口

以下接口都需要 `Authorization: Bearer <access_token>`。路径采用当前 `/v1` API 风格；所有上传授权响应都返回每个文件独立的 URL，响应不单独暴露 OSS key。

接口级错误沿用 `im-api` 当前统一响应体 `{ "error_code": "...", "message": "..." }`。无效或缺失 access token 返回 HTTP 401、`invalid_token`；未列出的服务端错误返回 HTTP 500、`internal_error`。下文列出的业务状态码和错误码是新增接口契约。

### 批量申请上传授权

`POST /v1/attachments/upload-authorizations`

请求中的 `conversation_id` 将本批附件绑定到目标会话。`files` 数量为 1 到 10；`size_bytes` 和 `content_type` 用于请求阶段的初步限制，上传完成后仍以 OSS 元数据为准。

```json
{
  "conversation_id": 10001,
  "files": [
    { "file_name": "google.png", "content_type": "image/png", "size_bytes": 120000 },
    { "file_name": "windows.webp", "content_type": "image/webp", "size_bytes": 80000 }
  ]
}
```

`im-api` 校验当前用户是会话成员、文件类型受支持、单图不超过 20 MiB 且本批合计不超过 50 MiB；随后为每张图片创建 `uploading` 记录并生成独立随机 key 和预签名 PUT URL。

```json
{
  "attachments": [
    {
      "attachment_id": "att-uuid-1",
      "upload_url": "https://oss.example/...",
      "method": "PUT",
      "headers": { "Content-Type": "image/png" },
      "expires_at": "2026-10-10T12:05:00+08:00"
    },
    {
      "attachment_id": "att-uuid-2",
      "upload_url": "https://oss.example/...",
      "method": "PUT",
      "headers": { "Content-Type": "image/webp" },
      "expires_at": "2026-10-10T12:05:00+08:00"
    }
  ]
}
```

响应数组顺序与请求 `files` 顺序一致，客户端据此把附件 ID 关联回编辑器中的图片块。典型错误为 `invalid_attachment_request`、`unsupported_image_type`、`attachment_too_large`、`conversation_not_found` 和 `not_conversation_member`。

申请接口采用整批拒绝：任一文件参数非法或用户无会话权限时，不创建本批附件记录，也不返回部分授权。错误映射为 HTTP 400 `invalid_attachment_request`、HTTP 400 `unsupported_image_type`、HTTP 413 `attachment_too_large`、HTTP 404 `conversation_not_found`、HTTP 403 `not_conversation_member`。例如：

```json
{
  "error_code": "unsupported_image_type",
  "message": "content_type must be image/jpeg, image/png, or image/webp"
}
```

### 批量确认上传完成

`POST /v1/attachments/upload-completions`

客户端收到每个 OSS PUT 的成功响应后调用此接口。OSS 不直接向 `im-api` 返回完成通知。

```json
{ "attachment_ids": ["att-uuid-1", "att-uuid-2"] }
```

`im-api` 只允许确认当前用户创建的附件；对每个处于 `uploading` 的对象执行 OSS 元数据查询，核实对象存在以及实际大小。满足限制的记录更新为 `uploaded`。重复确认已是 `uploaded` 的附件时返回当前状态，便于客户端在响应丢失后安全重试。接口对每个 ID 返回结果，允许部分成功：

```json
{
  "attachments": [
    { "attachment_id": "att-uuid-1", "status": "uploaded", "size_bytes": 120000 },
    { "attachment_id": "att-uuid-2", "status": "uploading", "error_code": "object_not_found" }
  ]
}
```

对象不存在或元数据查询暂时失败时，该项保留 `uploading`，返回 `object_not_found` 或 `storage_unavailable`，客户端可重试 PUT/确认。若对象实际大小超限，该项变为 `expired`、返回 `attachment_too_large`；待对应上传 URL 过期后再删除对象，避免尚有效的 URL 在清理后重新写入。未知、其他用户的附件 ID 返回 `attachment_unavailable`，不泄露附件归属。客户端在本条消息所有图片变成 `uploaded` 前不发送消息。当前 `storage.Store` 通过 `StatObject` 查询对象元数据，不读取对象正文。

请求格式错误或 ID 数量超限时整批返回 HTTP 400 `invalid_attachment_request`；成功受理的批次即使存在单项失败，也返回 HTTP 200 和逐项结果。统一错误响应格式见本节开头。

### 批量申请下载授权

`POST /v1/conversations/{conversation_id}/attachments/download-authorizations`

请求只传本次需要显示的附件 ID：

```json
{ "attachment_ids": ["att-uuid-1", "att-uuid-2"] }
```

`im-api` 校验请求者是该会话成员，且每个附件均为该会话中已关联消息的附件，然后为每个 OSS 对象签发独立短期 GET URL。响应不包含 `object_key`：

```json
{
  "attachments": [
    {
      "attachment_id": "att-uuid-1",
      "download_url": "https://oss.example/...",
      "expires_at": "2026-10-10T12:10:00+08:00",
      "content_type": "image/png",
      "size_bytes": 120000
    }
  ]
}
```

所有图片均通过会话成员和附件关联校验后才返回授权。若 ID 不属于该会话或尚未关联消息，返回稳定错误 `attachment_unavailable`，不泄露对象 key。URL 过期后客户端再次批量申请，不修改消息记录。

下载授权采用整批校验：请求格式非法返回 HTTP 400 `invalid_attachment_request`；会话不存在或用户不是成员分别返回 HTTP 404 `conversation_not_found`、HTTP 403 `not_conversation_member`；任一附件不可用时整批返回 HTTP 404 `attachment_unavailable`，不签发部分 URL。成功时返回 HTTP 200。统一错误响应格式见本节开头。

## 扩展现有消息接口

### WebSocket `send_message`

现有 `send_message` envelope 和 `client_message_id` 幂等语义不变；`message_type` 增加 `rich`。已有 `text` 消息结构保持兼容。`rich` 内容由按序排列的 `blocks` 组成：

```json
{
  "type": "send_message",
  "request_id": "req-uuid",
  "payload": {
    "client_message_id": "client-uuid",
    "conversation_id": 10001,
    "message_type": "rich",
    "content": {
      "blocks": [
        { "type": "image", "attachment_id": "att-uuid-1" },
        { "type": "text", "text": "这是谷歌的标识" },
        { "type": "image", "attachment_id": "att-uuid-2" },
        { "type": "text", "text": "这个微软的标识" }
      ]
    },
    "client_sent_at": "2026-10-10T20:00:00+08:00"
  }
}
```

数组顺序是消息的呈现顺序，不能按 block 类型重新排序。服务端可提前校验 block 类型、文字总长度、图片数量及附件 ID 格式，并生成包含 blocks 顺序和附件 ID 的规范化内容哈希。同一 `client_message_id` 的重试内容必须完全一致。对于尚未接受的新消息，只有在消息记录插入成功且尚未提交后，才在同一发送事务中查询附件，核实其属于发送者、绑定同一会话且状态为 `uploaded`，并按附件表中的实际 `size_bytes` 再次核实单图和合计大小限制，不能信任客户端声明值。附件数据库状态校验不能先于并发重复请求的幂等恢复，否则原消息已将附件改为 `attached` 时会错误拒绝重试。

### 确认、推送、事件与历史

- `server_accepted`、`message_created` 的 envelope 不变；其中的 `Message` 可携带 `message_type: "rich"` 和上述 `content`。
- Kafka `message_created` 事件 envelope 不变，事件中的消息内容保留 blocks 顺序和附件 ID；无需在 Kafka 中传图片数据或临时下载 URL。
- `GET /v1/conversations/{conversation_id}/messages` 路径和分页游标不变；历史页中的 `Message` 可为 `text` 或 `rich`。
- 发送拒绝仍使用 `send_message_rejected`。服务端使用稳定错误码 `attachment_not_ready` 和 `attachment_forbidden`。

`attachment_not_ready` 表示附件仍在 `uploading`、已过期或尚未完成上传；`attachment_forbidden` 表示附件不属于发送者或绑定了其他会话。按现有 WebSocket 错误结构，在 `send_message_rejected.payload` 中返回 `client_message_id`、`error_code` 和调试用 `message`；语法错误继续使用 `invalid_message`。批量附件验证失败时整条消息拒绝，不保存消息或 outbox 事件。

`im-chat` 保留当前以 `(sender_user_id, client_message_id)` 为唯一键的幂等语义。完成格式校验及已有的发送者、会话检查后，按以下顺序处理：

1. 在 MySQL 事务内初查幂等记录。若已存在，比较会话、消息类型和规范化内容哈希；三者均相同则结束事务并返回已有确认，否则返回 `duplicate_client_message_conflict`。此分支不要求附件仍处于 `uploaded`。
2. 初查未命中时，先锁定会话行并分配 `conversation_seq`，随后执行 `insert_message` 写入消息记录，暂不提交，也暂不执行附件数据库状态校验。
3. 若消息插入发生唯一键冲突，先整体回滚当前事务，包括本次序号分配，再在事务外按发送者和 `client_message_id` 重读已提交消息。只有确实命中该幂等键且会话、消息类型、内容哈希均相同时，才返回已有确认；命中但不一致则返回 `duplicate_client_message_conflict`。未命中幂等记录或发生其他数据库错误时，按服务端错误处理，不能吞掉错误或当作发送成功。不能仅凭 SQLSTATE `23000` 就认定是幂等重复，因为它还包含其他完整性约束错误。
4. 只有消息插入成功后，才在同一事务内执行附件数据库校验，将附件关联到新 `message_id` 并更新为 `attached`，然后插入 outbox 事件。附件校验、关联或 outbox 写入失败时，整体回滚消息、序号分配、附件更新和 outbox 写入。
5. 提交事务成功后才发送 `server_accepted`。插入但未提交的消息不代表已接受，不能提前确认或触发正式消息投递。

同一请求并发到达时，即使最初都查不到幂等记录，也必须收敛到同一条正式消息。例如：

| 阶段 | 请求 A | 请求 B（相同发送者、`client_message_id` 和内容） |
| --- | --- | --- |
| 初查 | 未命中已有消息。 | 也未命中已有消息。 |
| 消息插入 | 取得会话锁，分配序号并插入消息，暂不提交。 | 等待会话锁。 |
| 提交 | 校验并关联附件，插入 outbox，提交。 | 取得会话锁，分配序号后插入消息，命中消息唯一键冲突。 |
| 确认 | 返回新消息的确认。 | 整体回滚，事务外重读并比较原消息，返回同一 `message_id` 和 `conversation_seq`；不再要求附件为 `uploaded`。 |

本范围的实现验收条件：

- 相同请求串行重试或并发重试都只生成一条消息和一个 outbox 事件，最终只增加一次会话序号。
- 并发场景必须让两个请求都完成首次未命中的幂等查询后再继续，以覆盖唯一键冲突后的恢复路径，不能仅用串行重试代替。
- 同一幂等键携带不同会话、类型或内容时返回幂等冲突。
- 附件校验或 outbox 写入失败不遗留消息、序号增量或部分附件关联。
- 非幂等重复的数据库错误不会返回成功。

当前代码已实现上述事务与幂等处理，并包含相应测试；标记为 ignored 的 MySQL 集成用例需要配置 `TEST_DATABASE_URL` 后才能运行。

## 端到端流程与恢复

1. 编辑器以有序 blocks 保存文本和本地图片文件；图片预览使用本地 URL。用户发送后客户端固定本次内容并生成一个 `client_message_id`。
2. 客户端调用批量上传授权接口，将 URL 分别 PUT 到 OSS；允许并发传输，但保持图片块和附件 ID 的映射。
3. 每张 PUT 成功后，客户端批量调用上传完成接口。部分失败时只重传失败图片；所有附件 `uploaded` 后才通过 WebSocket 发送 rich 消息。
4. `im-chat` 按上述幂等流程处理：新消息先在事务中插入，再校验并关联附件、写入 outbox，提交成功后返回 `server_accepted`；重复请求返回已提交的原消息确认。会话成员通过 `message_created` 收到正式消息。
5. 实时消息或历史页到达客户端后，客户端为当前可见消息收集附件 ID，批量请求下载授权，再逐图从 OSS 下载并渲染。可以按需加载；URL 过期时刷新授权。

失败处理：

- 授权申请失败：消息不发送，编辑内容保留。
- PUT 中断且原授权仍有效：使用同一 URL 重试上传，再确认原附件 ID。若授权已过期，重新申请授权会创建新的附件 ID 和 key；客户端更新该图片块的 ID，旧附件由清理任务回收。其他已上传图片继续复用原附件 ID。
- 完成接口部分失败：只重试失败项；超期的未完成对象由清理任务删除。
- 消息明确被拒绝：图片保持 `uploaded`，用户可重试或取消；取消后未关联附件超期清理。
- `server_accepted` 响应丢失：以相同 `client_message_id` 和完全相同的会话、消息类型及 blocks/attachment IDs 重试；即使重试与原请求并发，服务端也按上述流程幂等返回原消息。客户端不重新上传或替换附件 ID，也不要求已关联附件重新变为 `uploaded`。
- 下载失败或 URL 过期：重新申请下载授权；消息内容仍使用稳定的附件 ID。

## 安全与实现边界

- OSS bucket 保持私有；上传、下载地址均使用短期签名。上传对象 key 由 `im-api` 生成，客户端不能指定或覆盖任意 key。
- 预签名 PUT 在过期前可能被再次使用并覆盖同一 key。首版接受这一短暂风险并使用随机 key 和配置的短有效期；严格不可变要求需另行采用 OSS 版本号或对象存储侧定版方案。
- 文件名、客户端声明的 MIME 类型和尺寸不能作为权限依据。服务端以附件记录和 OSS 实际对象大小为准；首版不验证文件 magic bytes 或解码图片。
- Tauri WebView 直传 OSS 需要 OSS CORS 允许桌面客户端来源、PUT 方法及签名要求的请求头。
- 附件表需纳入 Go `im-api` 的 schema migration；Rust `im-chat` 对同一 schema 执行事务内查询/更新。对象元数据查询是存储接口的新增能力。

## 当前接口变化清单

| 接口/结构 | 变化 |
| --- | --- |
| `POST /v1/attachments/upload-authorizations` | 新增，批量创建附件记录并签发逐图 PUT URL。 |
| `POST /v1/attachments/upload-completions` | 新增，逐附件确认对象已上传。 |
| `POST /v1/conversations/{conversation_id}/attachments/download-authorizations` | 新增，批量签发逐图 GET URL。 |
| WebSocket `send_message` | 扩展支持 `message_type: "rich"`；保留 `text`。 |
| WebSocket `server_accepted` / `message_created` 与 Kafka `message_created` | Envelope 不变，Message 内容可含 rich blocks。 |
| `GET /v1/conversations/{conversation_id}/messages` | 路径和分页不变，响应 Message 内容扩展为 rich blocks。 |
| 头像上传/下载及资料更新接口 | 不变，继续使用既有头像流程。 |

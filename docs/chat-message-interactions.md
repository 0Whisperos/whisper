# 聊天消息交互与图片查看规划

状态：复制与持久回复已有实现；本轮增加单目标普通转发，验证记录见下节。撤回及撤回状态校准仍为后续设计，撤回菜单保持占位。当前交付范围及实际接口以本节和 [消息协议](message-ack-protocol.md)、[数据库结构](database-schema.md) 为准。

## 单目标转发实施范围（2026-10-19）

- 正式 `accepted` 消息的右键菜单提供转发。弹窗一次选择一个可发送的有效私聊，支持转发回原会话；无会话 ID 的好友禁用并显示原因。
- 确认后直接发送，以当前用户身份生成新的普通消息，正文和图文顺序保持不变，不携带原作者、来源或回复关系。成功后关闭弹窗并留在当前会话。
- 转发使用独立临时状态，源会话及目标会话的正文和回复草稿均不修改。图文先重新申请源下载授权，再取得完整原始图片，使用目标会话的新附件记录和独立 OSS 对象。
- 完整取得内容后，转发任务持有独立副本；此后的源消息变化不影响这份副本。未来接入撤回时沿用该边界，不采用“目标消息发送成功前始终受源撤回限制”的旧设计。
- 任一图片授权、下载、上传或确认失败时，不发送残缺消息。失败保留完整内容与成功上传的附件供重试；最终提交后的重试沿用同一 `client_message_id`、正文和目标附件。
- 发送成功以服务端正式确认或创建事件为准。确认超时显示待确认状态；关闭弹窗不撤销已发出的请求，可在消息列表中继续重试。
- 本轮接受取消、失败留下的未关联附件记录与 OSS 对象暂时积累；现有附件过期清理仍是 TODO，不包含在本轮交付中。
- 复用现有 HTTP 附件接口与 `send_message`，不新增数据库字段或服务端协议。撤回、撤回同步、缓存撤回失效和网络自动重连属于后续范围。

### 转发验证记录

- 前端全量：`npm test -- --reporter=dot`，67 个测试文件、475 项测试通过。覆盖转发菜单和单选弹窗、独立图文副本、原始字节与新附件、失败不发送、部分上传重试、发送幂等、迟到确认、目标失效、取消/账号隔离以及双会话正文与回复草稿保留。
- 生产构建：`npm run build -- --outDir .tmp/message-forwarding-final-build` 通过，包含 TypeScript 检查。构建产物写入独立临时目录。
- Chrome 界面检查：使用隔离 fixture 和两个浏览器页面，验证图文按“前、图片、中、图片、后”到达接收页面且不携带回复；验证文字转发回原会话、成功关闭弹窗、源草稿保留、键盘焦点及 390×640 嵌入视口布局。fixture 模拟附件接口与消息投递，这项结果不代表真实服务或 Windows WebView2 验收通过。
- 真实服务双客户端验收已尝试，但本地登录接口返回 HTTP 503 `no_available_chat_node`，尚不能建立已认证测试会话，因此真实 OSS 附件独立下载与双客户端桌面流程仍待验收。本次只注册了一名昵称以“转发验收A”开头的专用测试用户，登录失败后未写入测试消息或附件。本轮未修改服务端或数据库结构。

## 前次确认的实施范围（2026-10-16）

- 消息复制不受 `sending`、`failed`、`accepted` 状态限制；可见正文中的文字和图片均可复制。本地图片使用独立保留的预览资源，正式图片复用受控附件缓存。单张图片复制原图位图，完整图文按顺序写入 HTML 与纯文本备用格式。
- HTML 写入剪贴板的 `text/html`，不是把 HTML 源码作为普通文字复制。`text/plain` 永远按文字插入；从网页代码块复制的转义 HTML 源码保留为文字，不执行二次解析。
- 回复目标随各会话草稿保留；取消回复只移除引用。输入框状态条、发送后的引用条、页外原消息提示，以及发送失败重试均保留一致的引用语义。
- 数据库只增加 nullable `reply_to_message_id`。客户端生成摘要；im-api 历史响应批量附带原目标必要正文；im-chat 校验同会话目标并贯通落库、幂等、确认与实时推送。
- 客户端消息包含 `reply_to_message_id` 和浅层 `reply_to: { message_id, sender_user_id, message_type, content } | null`，不递归附带原目标自己的引用。普通消息引用为空；旧消息缺字段兼容为空。
- 2026-10-16 的交付未实施转发、撤回及撤回状态校准。转发由上述 2026-10-19 范围补充；撤回相关章节仍属于后续设计。

### 本次验证记录

- im-client：`npm test -- --reporter=dot`，60 个文件、421 项测试通过；覆盖 HTML 源码文字、混排顺序、全部消息状态复制、回复 UI、快照、重试及协议接线。
- 生产构建：`npm run build -- --outDir .tmp/message-interactions-build` 通过，包含 TypeScript 检查。当前环境默认 `dist/assets` 清理遇权限限制，因此使用独立构建输出目录。
- Chrome 实际界面检查：已验证正常宽度和 390×720 窄窗口下的引用气泡、右键回复、回复状态条与输入区排列；预览使用仓库 mock 数据，未发送真实消息。临时页面和服务已清理。
- Tauri Rust：`cargo test --offline -- --test-threads=1`，48 项通过；`cargo check --offline` 通过。
- im-chat：默认测试 101 项通过；专用 MySQL 显式执行的消息存储测试 15 项通过，含 3 项新持久回复集成；`cargo check` 通过。未运行本次无关的 Redis/Kafka 外部环境测试。
- im-api：`go test ./...`、`go vet ./...` 通过。真实 GORM migration 在专用 `whisper_cdc_test` 库验证了唯一新增回复列为 nullable `CHAR(36)`、默认 `NULL`，无反向索引；未操作业务数据库。本次启动的专用测试 MySQL 已恢复停止。
- 当前 `CGO_ENABLED=0` 且缺少 GCC，SQLite 的 cgo 持久化/升级测试未执行；Windows 原生剪贴板与 WebView2 跨应用往返、实际双客户端桌面流程尚未人工验收。

现有消息发送与回执语义见 [消息与回执协议](message-ack-protocol.md)，混合图文消息和附件授权见 [聊天图片消息流程](chat-image-message-flow.md)，桌面图片缓存见 [聊天图片本地磁盘缓存方案](chat-image-disk-cache.md)，当前 MySQL 结构见 [数据库表结构规划](database-schema.md)，事件封装见 [Kafka Outbox 事件封装](kafka-outbox-event-envelope.md)。

## 完整交互设计范围（包含后续功能）

本期为 `im-client` 增加消息气泡和图片的自定义交互，并补齐这些交互依赖的持久回复、普通转发和撤回能力。

已确认的用户行为如下：

- 鼠标移到已经加载成功的聊天图片上时显示放大镜光标。
- 左键点击聊天图片，在独立桌面窗口中打开图片查看器。
- 右键点击聊天图片，只显示“复制”和“下载原图”。
- 右键点击消息气泡内的非图片区域，显示“复制”“回复”“转发”；本人已经发送成功且尚未撤回的消息额外显示“撤回”。
- 图片右键菜单优先于消息菜单，不允许同一次右击同时打开两个菜单。
- 全客户端关闭 WebView/WebView2 默认右键菜单，包括登录页、空白区域和消息输入框。输入框仍支持键盘剪切、复制和粘贴。
- 回复是持久引用，不是把摘要拼进普通文本。发送后的回复气泡在正文上方显示引用条。
- 转发一次只选择一个好友或已有会话，以当前用户身份重新发送消息正文，不显示原作者和来源，也不携带原消息的回复关系。
- 只有原发送者可以撤回消息，不限制撤回时间。撤回后双方显示占位提示，引用该消息的摘要变为“原消息已撤回”。

本期不包含：

- “添加表情”、表情回应及表情回应列表。
- “1 条回复”入口、回复线程或独立回复会话。
- 批量选择消息、多目标转发、合并转发或显示转发来源。
- 管理员撤回、群主撤回、定时撤回或按时间限制撤回。
- 跨越尚未加载历史记录的全会话图片检索。
- 消息编辑、删除本地记录、收藏、Pin、创建话题和翻译。
- 撤销已经保存到用户目录、已经写入系统剪贴板或已经成功转发出的图片副本。

## 实现依据与代码职责

| 本地证据 | 当前行为及设计影响 |
| --- | --- |
| [`ChatPanel.tsx`](../im-client/src/features/chat/components/ChatPanel.tsx) | 组合现有菜单、图片交互和回复状态；气泡正文拆到 `ChatMessageBubble`，回复摘要和导航各有独立模块。 |
| [`RichMessageEditor.tsx`](../im-client/src/features/chat/components/RichMessageEditor.tsx) | 编辑器接收有序图文 blocks；复制粘贴使用受控 HTML 转换，纯文本中的 HTML 代码按字面插入。 |
| [`attachmentResourceCache.ts`](../im-client/src/features/chat/attachmentResourceCache.ts) | 当前图片资源可能来自 Tauri asset URL 或当前 WebView 的 Blob URL。独立窗口不能把主窗口 Blob URL 当作稳定资源契约，应通过 Rust 缓存键读取原图。 |
| [`useChatMessaging.ts`](../im-client/src/features/chat/hooks/useChatMessaging.ts) | 已具备文本/富文本 optimistic message、确认超时、失败和重试流程；回复要在现有发送输入和幂等语义上增加引用 ID。 |
| [`message/store.rs`](../im-chat/src/message/store.rs) | 消息、附件关联和 outbox 在同一事务完成。附件只能由原上传者在绑定会话中从 `uploaded` 单次转为 `attached`，因此转发不能复用原 `attachment_id`。 |
| [`message.go`](../im-api/internal/model/entity/message.go) | 本次只增加回复目标列；迁移由现有 GORM `AutoMigrate` 管理，撤回时间列属于后续设计。 |
| [`attachments/service.go`](../im-api/internal/service/attachments/service.go) | 下载授权已经校验会话成员及附件关联状态；撤回后还需联查关联消息状态，禁止继续签发新授权。 |
| [`message-ack-protocol.md`](message-ack-protocol.md) | `conversation_seq` 和成员游标只描述消息创建顺序。撤回旧消息不会产生新序号，离线客户端不能只依赖 `delivered_seq` 发现撤回。 |

## 交互规格

### 自定义菜单通用行为

客户端在捕获阶段阻止默认 `contextmenu`。只有下表中的目标可以打开自定义菜单：

| 点击区域 | 前置条件 | 菜单项 |
| --- | --- | --- |
| 已加载的气泡图片 | 消息未撤回，图片资源可用 | 复制、下载原图 |
| 消息气泡非图片区域 | 消息可见且未撤回 | 复制、回复、转发；本人已发送成功的消息再显示撤回 |
| 独立查看器中的图片 | 当前查看器 session 有效 | 复制图片 |
| 撤回占位、头像、消息列表空白、输入框、其他页面 | 无 | 不显示自定义菜单，也不显示系统菜单 |

处于 `sending` 或 `failed` 的本地临时消息允许复制完整可见正文，包括本地图片；回复、转发和撤回要求正式 `message_id`。已加载的本地预览图提供“复制”，不提供下载和查看器；正式图片保留“复制、下载原图”。图片尚未加载或加载失败时不显示图片菜单。

菜单使用触发点附近的屏幕坐标定位，并限制在当前窗口可视区域内。发生以下任一情况时关闭：点击菜单外部、按下 Escape、切换会话、窗口失焦、消息状态变为撤回或菜单对应 DOM 被卸载。

### 图片查看器

图片查看器使用固定窗口标签 `image-viewer`。重复打开图片时复用并聚焦同一窗口，而不是创建多个窗口。

当前图片序列按下列规则生成：

1. 只取当前会话已经加载到客户端内存中的正式、未撤回消息。
2. 按 `conversation_seq` 升序排列消息。
3. 同一条富文本消息内按 `blocks` 原顺序排列图片。
4. 不主动加载更早历史；用户回到聊天窗口加载历史后，主窗口可以更新查看器 session。

查看器提供：

- 上一张和下一张；到达序列首尾时禁用对应按钮。
- 初始按窗口适配，并且不放大超过 100%。
- 缩放范围 25% 到 500%，每次调整 25 个百分点，显示当前比例。
- 顺时针旋转 90°。旋转只属于当前查看状态，切换图片时每张图片分别保存本次 session 内的角度。
- 图片超过可视区域时允许滚动或拖动查看。
- “下载原图”始终保存缓存中的原始字节，不写入当前缩放和旋转结果。
- 右击“复制图片”同样复制原始图片位图，不写入当前旋转结果。

如果当前图片对应的消息被撤回，主窗口更新 session 并从序列中移除该消息的全部图片。查看器优先选中移除项之后的图片，没有下一张时选择上一张；序列为空时显示“图片已不可用”并关闭窗口。

### 下载原图

“下载原图”打开系统“另存为”对话框。默认文件名为 `<attachment_id>.<ext>`，扩展名由缓存记录中的受支持媒体类型映射，不信任消息正文或用户输入的路径。用户取消对话框属于正常结束，不显示错误。

保存时从已经验证的聊天图片缓存复制原始字节。Rust 必须再次确认缓存键属于当前用户、会话和附件，并确认源路径位于专属缓存根目录内。前端不能向 command 传入任意源路径。

### 复制图片与完整消息

单图片复制向系统剪贴板写入位图格式。完整消息复制一次写入 HTML 和纯文本 fallback，不能先后执行两个会清空剪贴板的独立写操作。

Whisper 自有 HTML 采用版本化、可识别的最小结构，例如：

```html
<div data-whisper-message-version="1">
  <p data-whisper-block="text">第一段文字</p>
  <img data-whisper-block="image" src="data:image/png;base64,..." alt="图片" />
  <p data-whisper-block="text">第二段文字</p>
</div>
```

规则如下：

- 文字必须 HTML 转义；图片只允许 JPEG、PNG、WebP data URL。
- block 顺序与消息内容顺序完全一致。
- 纯文本 fallback 保留文字，并在图片位置写入 `[图片]`。
- 复制回复消息时只复制本次消息正文，不复制引用目标的正文，避免无意复制两条消息。
- 不写入 access token、签名 URL、本地绝对路径或 OSS object key。
- 消息图片总量沿用现有 50 MiB 限制；Base64 膨胀或系统剪贴板拒绝时返回稳定失败状态，不静默宣称成功。

编辑器粘贴时优先识别 `data-whisper-message-version="1"`，按 DOM 顺序恢复文字和图片 blocks。对外部 HTML 只读取普通文字和允许的内嵌图片，不直接渲染外部 HTML，不请求远程 `http`/`https` 图片，不执行样式、脚本或事件属性。系统剪贴板只提供图片文件时，继续使用现有图片粘贴流程。

只有剪贴板 `text/html` 才参与 HTML 解析。纯文本中的 `<div>`、`<img>` 等代码按字面文字保留；`pre`/`code` 中的可见源码不进行二次解析。原生 HTML 补读仅由用户粘贴事件触发。HTML 的 IPC/解析上限为 72 MiB，图片沿用单图 20 MiB、每条最多 10 张、合计 50 MiB；超过限制整体失败，不复制或粘贴不完整图文。

外部应用是否接受 data URL 图片由其剪贴板实现决定。本期只承诺 Whisper 客户端之间的图文顺序往返，以及纯文本 fallback 可用。

### 回复

选择“回复”后，输入框上方显示回复状态条，包含被回复用户、单行摘要和取消按钮。用户仍可编辑普通文字、粘贴图片或选择图片；发送时将回复目标作为消息元数据提交。

摘要规则：

本次以下摘要规则均在客户端执行，服务端只返回目标的必要原文；用户名从成员资料解析，不额外写入数据库。撤回相关摘要规则为后续设计。

- 取原消息 blocks 中第一段非空文字，压缩为单行并最多显示 80 个 Unicode 字符。
- 没有文字但有图片时显示 `[图片]`；有多张图片时显示 `[N张图片]`。
- 同时存在文字和图片时显示截断文字，并附加 `[图片]` 或 `[N张图片]`。
- 原消息已撤回时只显示“原消息已撤回”，不返回或保留旧摘要。

回复消息的气泡在正文上方显示引用条，样式参考需求截图：弱化背景、左侧强调线、第一行“回复 用户名：摘要”，正文位于引用条下方。用户名由 `sender_user_id` 在当前会话成员资料中解析，资料缺失时显示“用户 <id>”。

点击引用条时：

- 原消息已加载且未撤回：滚动到对应 `data-message-key`，并短暂高亮。
- 原消息已加载但已撤回：定位撤回占位。
- 原消息未加载：不自动发起无限历史查询，提示“原消息尚未加载，请先加载更早记录”。

发送回复前，服务端必须确认引用消息存在、属于同一会话且尚未撤回。验证结果以服务端数据库为准，客户端摘要不参与可信数据写入。

### 单目标普通转发

转发选择器只允许选择一个当前用户可发送消息的有效会话。好友若没有可用 `conversation_id`，目标项禁用并显示原因。允许转发回原会话。

文本消息直接以新的 `client_message_id` 走现有发送流程。混合图文消息按以下顺序执行：

1. 使用源会话和源附件 ID 重新申请下载授权；即使本地缓存命中，也不能绕过本次授权检查。
2. 下载原始图片 Blob，不转码、不修改尺寸。
3. 为目标会话申请新的上传授权。
4. 上传并确认每张图片，取得新的 `attachment_id`。
5. 按原 blocks 顺序替换附件 ID，以当前用户身份发送新的普通文本或富文本消息。

转发任务使用独立临时状态，不写入或清空源会话、目标会话的编辑器草稿。任一图片授权、下载、上传或确认失败时，不发送不完整消息；保留选择器中的失败状态供用户重试或取消。已成功上传但最终没有发出的目标附件会留下未关联记录和 OSS 对象；当前仓库的过期清理任务仍是 TODO，本轮明确接受这项存储积累，不包含清理或补偿能力。

源图片下载授权沿用现有批次原子语义：同一批中任一附件不存在、无权访问或未关联时，整批授权失败。客户端不得把成功子集继续拼成一条不完整的转发消息。撤回后的授权限制将在后续撤回功能中实现。

普通转发不携带 `reply_to_message_id`。完整取得正文和全部图片后，转发任务即持有独立副本；后续源消息撤回不阻断该任务，也不级联撤回已发送副本。未来撤回功能只限制尚未完成内容取得时的新授权，不增加最终发送阶段的源消息校验。

### 撤回

“撤回”只对满足以下条件的消息显示：

- `sender_user_id` 等于当前登录用户。
- 存在正式 `message_id`，本地状态为 `accepted`。
- `recalled_at` 为空。

服务端不信任客户端的发送者判断，仍按当前认证用户验证消息所有权。撤回不限制创建时间。第一次成功撤回时，在一个 MySQL 事务中写入 `messages.recalled_at` 并插入 `message_recalled` outbox 事件；对同一消息重复撤回返回第一次的 `recalled_at`，不重复写事件。实现使用行锁或 `recalled_at IS NULL` 条件更新区分首次写入与并发重复，保证并发请求也只产生一个时间值和一条 outbox 事件。

撤回后的表现：

- 原气泡替换为“你撤回了一条消息”或“<用户> 撤回了一条消息”。
- 不再向客户端返回原正文、图片 blocks 或回复元数据。
- 引用该消息的其他回复仍保留自己的正文，但引用条变为“原消息已撤回”。
- 客户端删除该消息的可见图片资源，并使对应磁盘缓存失效。
- `im-api` 不再为关联附件签发新的下载授权。
- 已经签发且尚未过期的 URL、外部保存文件和系统剪贴板内容无法由服务端追回，文案和实现不得承诺远程删除这些副本。

撤回不是新消息，不分配新的 `conversation_seq`，也不改变 `conversations.last_seq`、`delivered_seq` 或 `read_seq`。

## 客户端与服务职责

### `im-client` React/TypeScript

建议在现有 `src/features/chat/` 内按职责增加模块，具体名称可沿用下列边界：

```text
components/
  MessageContextMenu.tsx
  ImageContextMenu.tsx
  ReplyComposerBanner.tsx
  ReplyQuote.tsx
  ForwardMessageDialog.tsx
  ImageViewer.tsx
hooks/
  useMessageActions.ts
  useImageViewer.ts
messageActionsApi.ts
clipboardFormat.ts
```

- `ChatPanel` 只负责组合消息行、把明确的消息/图片目标交给 action hook，并渲染菜单和回复引用。
- 菜单组件负责展示、键盘焦点、关闭行为和可访问性，不直接调用 HTTP、WebSocket 或 Tauri `invoke`。
- `useMessageActions` 负责复制、回复状态、转发任务、撤回请求和错误反馈编排。
- `messageActionsApi.ts` 集中封装 HTTP、WebSocket action 和 Tauri command，不在 JSX 中散落 command 字符串。
- `clipboardFormat.ts` 只负责可信 HTML 生成、白名单解析和 blocks 转换，便于纯函数测试。
- `useChatMessaging` 扩展发送输入、optimistic message 和正式消息合并；撤回状态采用单调合并，已经确认撤回的消息不能被延迟 `message_created` 或旧历史响应恢复。
- `RichMessageEditor` 增加有序 HTML 粘贴入口，继续复用现有 `onPickFiles` 校验图片数量、类型和大小。

### Tauri Rust

`src-tauri/src/lib.rs` 只注册窗口、state、command 和插件。具体职责拆到聚焦模块：

```text
commands/
  image_viewer.rs
  clipboard.rs
  image_export.rs
image_viewer.rs
clipboard.rs
platform/
  webview.rs
```

- `image_viewer` Rust state 保存单个 session 的用户、会话、按顺序排列的缓存键、当前索引和递增版本号。每张图片的旋转与缩放由 viewer 前端在当前窗口会话内维护；关闭 viewer 后不持久化。
- command 参数使用稳定 DTO，不接受 access token、任意本地源路径或任意远程 URL。
- 剪贴板模块负责图片解码、位图写入、HTML/纯文本同次写入及 HTML fallback 读取，并把平台错误映射为稳定错误码。
- 导出模块通过系统保存对话框取得目标路径，再从受控缓存读取并复制原始字节。
- Windows 上通过 WebView2 settings 关闭 main 和 viewer 的默认 context menu；前端捕获逻辑作为浏览器开发模式和其他平台的统一行为。
- viewer 使用单独最小 capability，只开放读取当前 viewer session、复制当前图片、保存当前图片和关闭窗口所需能力。

### `im-chat`

- 扩展 `send_message` payload 和正式消息模型，支持可选 `reply_to_message_id`。
- 发送时先按 `(sender_user_id, client_message_id)` 查找并比较已有消息；命中且会话、类型、内容和引用目标一致时直接恢复原确认。只有确定是新消息后，才校验引用目标当前仍存在、属于同一会话且未撤回，避免原消息后来撤回导致已经成功的回复无法幂等重试。附件也保持同样的“先恢复幂等、再校验新请求资源”顺序。
- 增加 `recall_message` WebSocket handler、所有权校验、幂等撤回事务和稳定错误映射。
- 把 outbox/Kafka 事件解析从只接受 `message_created` 扩展为显式的创建/撤回联合类型。
- 复用现有会话分区 key、Redis presence、同节点队列和跨节点 HTTP 转发，把 `message_recalled` 推送给在线成员。
- 不把离线用户视为失败；离线撤回由历史响应和重连状态校准补齐。

### `im-api`

- 本次 GORM entity 只增加回复目标，由现有迁移入口执行 `AutoMigrate`；撤回时间属于后续迁移。
- 历史消息查询批量收集当前页的 `reply_to_message_id`，一次查询并附带浅层目标正文，摘要交给客户端，避免 N+1 查询。
- 历史消息返回前按 `recalled_at` 清除正文和回复元数据；引用目标已撤回时返回 `recalled = true` 和空摘要。
- 增加批量消息状态查询接口，供已登录客户端在 WebSocket 重连后校准已经加载的旧消息。
- 附件下载授权联查关联消息；消息撤回后返回稳定业务错误，不再签发新 URL。
- HTTP handler 只负责解析、鉴权上下文和错误码映射；查询和摘要规则放在消息领域 service/repository 中。

## Tauri command 契约

command 名称集中在前端 API 封装中。以下为规划契约，字段按 Tauri `camelCase` 参数映射。

### 准备并打开查看器

`prepare_image_viewer_session`

```json
{
  "apiBaseUrl": "https://api.example.com",
  "userId": 20001,
  "conversationId": 10001,
  "images": [
    { "messageId": "message-uuid-1", "attachmentId": "attachment-uuid-1" },
    { "messageId": "message-uuid-2", "attachmentId": "attachment-uuid-2" }
  ],
  "selectedAttachmentId": "attachment-uuid-2"
}
```

Rust 验证所选附件存在有效缓存记录，创建或替换 session，打开/聚焦 `image-viewer`，返回 `{ "sessionId": "...", "version": 1 }`。其他图片允许在查看器内显示单项错误，但所选图片无法读取时不打开空窗口。

### 读取查看器状态

`get_image_viewer_session`

请求：

```json
{
  "sessionId": "viewer-session-uuid"
}
```

响应：

```json
{
  "sessionId": "viewer-session-uuid",
  "version": 2,
  "conversationId": 10001,
  "currentIndex": 1,
  "images": [
    { "messageId": "message-uuid-1", "attachmentId": "attachment-uuid-1", "assetUrl": "asset://..." },
    { "messageId": "message-uuid-2", "attachmentId": "attachment-uuid-2", "assetUrl": "asset://..." }
  ]
}
```

viewer 应先订阅 `image-viewer-session-updated`，再调用本 command 读取快照；事件只携带 `sessionId` 和 `version`，实际数据以 command 快照为准，避免窗口初始化时丢失事件。

### 剪贴板和保存

| Command | 输入 | 成功结果 | 说明 |
| --- | --- | --- | --- |
| `copy_chat_image` | 用户、会话、附件缓存键 | `null` | 解码原图并写入系统位图剪贴板。 |
| `write_chat_message_clipboard` | 有序的文字/附件 blocks 及缓存命名空间 | `null` | Rust 从缓存读取图片，生成 HTML 和纯文本并同次写入。 |
| `read_chat_clipboard_html` | 无 | `{ html: string | null }` | WebView paste event 不能提供 HTML 时的受控 fallback。 |
| `save_chat_image` | 用户、会话、附件缓存键 | `{ saved: true, filePath: string }` 或 `{ saved: false }` | 打开系统保存对话框；取消返回 `saved: false`。 |
| `close_image_viewer_session` | `sessionId` | `null` | 清除 Rust state 并关闭 viewer。 |

`filePath` 只用于成功后的用户提示，不作为后续 command 的输入。错误返回稳定 code，例如 `viewer_session_expired`、`image_not_cached`、`image_unavailable`、`unsupported_media_type`、`clipboard_write_failed`、`save_failed`；内部 IO、平台 API 或绝对源路径细节只记录在安全日志中。

### 消息剪贴板（本次新增）

- `write_chat_message_clipboard`：仅允许 `main` 调用。参数为 `apiBaseUrl`、`userId`、`conversationId` 和有序 `blocks`。文字块为 `{ type: "text", text }`；图片块的 `source` 为 `{ kind: "cache", attachmentId }` 或本地临时图片的 `{ kind: "inline", contentType, base64 }`。Rust 再次校验图片类型、解码结果、数量和大小；不接收任意源路径或远程 URL。
- 只有一张图片且其余文字均为空白时写原生位图；其他正文一次写 HTML 与纯文本备用格式。生成完整内容后才触碰剪贴板，失败不写入成功子集。
- `read_chat_clipboard_html`：仅允许 `main` 调用，返回 `{ html: string | null }`；前端只在用户粘贴事件缺少 HTML 时补读。原生读取与图片/消息写入共用锁，不新增通配 clipboard/fs 权限。
- HTML 超过 72 MiB 返回 `clipboard_content_too_large`；此上限约束生成、IPC 和解析，arboard 系统读取仍可能先分配原内容。剪贴板读写失败使用稳定错误码，界面反馈失败并允许重试。

## 消息协议扩展

### 正式消息 DTO

活动回复消息示例：

```json
{
  "message_id": "message-uuid-new",
  "conversation_id": 10001,
  "conversation_seq": 43,
  "sender_user_id": 20002,
  "client_message_id": "client-message-uuid",
  "message_type": "text",
  "content": { "text": "这个间隔还有多少优化空间？" },
  "reply_to_message_id": "message-uuid-original",
  "reply_to": {
    "message_id": "message-uuid-original",
    "sender_user_id": 20001,
    "message_type": "text",
    "content": {
      "text": "对于每个球，算法观察+分析到最后得出结论的耗时约为4.5～4.7s"
    }
  },
  "created_at": "2026-10-14T18:30:00.000+08:00"
}
```

以下撤回 DTO 为后续方案，本次尚不实现。引用目标撤回后，回复消息自身仍是活动消息，但引用结构拟变为：

```json
{
  "message_id": "message-uuid-original",
  "sender_user_id": 20001,
  "recalled": true,
  "summary": null
}
```

撤回消息示例：

```json
{
  "message_id": "message-uuid-original",
  "conversation_id": 10001,
  "conversation_seq": 42,
  "sender_user_id": 20001,
  "client_message_id": "original-client-message-uuid",
  "message_type": "rich",
  "content": null,
  "reply_to": null,
  "recalled_at": "2026-10-14T18:35:00.000+08:00",
  "created_at": "2026-10-14T18:25:00.000+08:00"
}
```

协议不返回撤回消息原正文。数据库可以保留原 `content` 作为消息事实，但所有面向客户端的 DTO mapper 必须根据 `recalled_at` 生成安全结构。

`content` 从必填对象扩展为“活动消息为对象、撤回消息为 `null`”，属于客户端类型契约变化；`server_accepted`、`message_created`、历史 API 和客户端解析器必须在同一发布批次支持该联合类型。撤回消息自身原有的 `reply_to` 同样返回 `null`。

### `send_message` 回复扩展

`reply_to_message_id` 是可选字段；普通消息和普通转发不发送该字段。

```json
{
  "type": "send_message",
  "request_id": "request-uuid",
  "payload": {
    "client_message_id": "client-message-uuid",
    "conversation_id": 10001,
    "message_type": "text",
    "content": { "text": "这个间隔还有多少优化空间？" },
    "reply_to_message_id": "message-uuid-original",
    "client_sent_at": "2026-10-14T18:29:59.000+08:00"
  }
}
```

服务端先按 `(sender_user_id, client_message_id)` 恢复幂等请求，除现有会话、类型和内容比较外，还必须比较 `reply_to_message_id`。正文相同但引用目标不同属于 `duplicate_client_message_conflict`。只有幂等查询确认不存在旧消息后，才检查引用目标当前是否撤回；已经成功发送的回复在原消息后来撤回后仍能返回原 `server_accepted`。

新增回复相关错误码：

| 错误码 | 条件 |
| --- | --- |
| `reply_message_not_found` | 引用 ID 不存在，或引用消息不属于目标会话。统一错误避免泄露其他会话消息是否存在。 |
| `reply_message_recalled` | 引用消息已经撤回。 |
| `invalid_reply_message_id` | 引用 ID 格式无效。 |

### `recall_message` 请求

```json
{
  "type": "recall_message",
  "request_id": "request-uuid",
  "payload": {
    "message_id": "message-uuid-original"
  }
}
```

成功响应：

```json
{
  "type": "recall_message_accepted",
  "request_id": "request-uuid",
  "payload": {
    "message_id": "message-uuid-original",
    "conversation_id": 10001,
    "conversation_seq": 42,
    "recalled_at": "2026-10-14T18:35:00.000+08:00"
  }
}
```

重复请求返回同一个 `recalled_at`。失败响应沿用统一错误结构：

```json
{
  "type": "recall_message_rejected",
  "request_id": "request-uuid",
  "payload": {
    "message_id": "message-uuid-original",
    "error_code": "message_not_owned",
    "message": "current user cannot recall this message"
  }
}
```

| 错误码 | 条件 |
| --- | --- |
| `invalid_message_id` | 消息 ID 格式无效。 |
| `message_not_found` | 消息不存在，或当前用户不是消息会话的有效成员。统一错误避免跨会话探测。 |
| `message_not_owned` | 消息存在且当前用户可见，但不是原发送者。 |
| `internal_error` | 事务、存储或未知服务端错误。 |

### `message_recalled` 实时事件

成功提交撤回事务后，通过现有 Kafka/presence 投递链路向当前在线成员发送：

```json
{
  "type": "message_recalled",
  "payload": {
    "event_id": "event-uuid",
    "conversation_id": 10001,
    "conversation_seq": 42,
    "message_id": "message-uuid-original",
    "sender_user_id": 20001,
    "recalled_at": "2026-10-14T18:35:00.000+08:00"
  }
}
```

该事件携带原消息已有的 `conversation_seq` 方便客户端定位，但它不是新序号，绝不能据此推进 `delivered_seq` 或 `read_seq`。客户端用 `event_id` 处理实时重复投递，用 `message_id` 单调更新消息状态，并更新所有引用该消息的 `reply_to`。

## Outbox 与 Kafka 扩展

`outbox_events` 表结构不变。第一次撤回与 `messages.recalled_at` 更新在同一事务中插入以下事件：

```json
{
  "event_id": "event-uuid",
  "event_type": "message_recalled",
  "aggregate_type": "chat_message",
  "aggregate_id": "10001",
  "event_version": 1,
  "occurred_at": "2026-10-14T18:35:00.000+08:00",
  "recalled_message": {
    "message_id": "message-uuid-original",
    "conversation_id": 10001,
    "conversation_seq": 42,
    "sender_user_id": 20001,
    "recalled_at": "2026-10-14T18:35:00.000+08:00"
  }
}
```

- `message_created` 的 envelope 保持现状，其内部 `message` body 增加 nullable `reply_to_message_id`，不写入计算后的摘要快照。发送方的即时 `server_accepted` 可使用事务中已读取的引用消息生成客户端 `reply_to`；Kafka consumer 投递 `message_created` 前按 `reply_to_message_id` 从 MySQL 读取当前目标并生成客户端 DTO。这样内部事件保存稳定引用 ID，而所有客户端出口仍获得统一的动态 `reply_to`。
- Kafka record key 继续使用 `conversation_id`，保证同一会话内创建和撤回事件进入同一分区并保持生产顺序。
- consumer 必须按 `event_type + event_version` 解析明确的联合类型，未知类型或版本记录为不可处理事件，不能误解析成创建消息。
- 已有事件完成标记和节点转发幂等沿用 `event_id`。
- 重复撤回不插入第二条 outbox 行，因此不会产生语义重复事件。
- 当前实时投递对单个在线成员是 best-effort，节点路由、队列或跨节点请求失败后不承诺为该成员持续重放。漏掉实时撤回的客户端最迟在下一次 WebSocket 认证后的批量状态校准中收敛。

## 离线撤回校准接口

仅依赖实时 `message_recalled` 不足以覆盖离线用户；仅重新读取最新一页历史也无法发现很早以前消息的撤回。因此新增：

`POST /v1/conversations/{conversation_id}/messages/statuses`

请求：

```json
{
  "message_ids": [
    "message-uuid-1",
    "message-uuid-2"
  ]
}
```

约束：

- 需要有效 Bearer access token。
- 当前用户必须是目标会话有效成员。
- 每批 1 到 100 个去重后的 UUID。
- 查询条件必须包含路径中的 `conversation_id`；其他会话或不存在的 ID 不返回记录，不能借此探测消息存在性。

响应：

```json
{
  "statuses": [
    { "message_id": "message-uuid-1", "recalled_at": null },
    { "message_id": "message-uuid-2", "recalled_at": "2026-10-14T18:35:00.000+08:00" }
  ]
}
```

客户端在每次 WebSocket 从非认证状态重新进入 `authenticated` 后执行：

1. 按会话收集当前内存中已加载的正式 `message_id`。
2. 同时收集这些消息引用的 `reply_to.message_id`。
3. 每个会话去重后按最多 100 个分批查询。
4. 将撤回状态单调合并进本地消息和引用摘要。
5. 单批失败不清空现有消息；记录可重试状态，并在下一次认证或用户手动重试时再次校准。

新启动客户端和新加载的历史页直接使用历史 DTO 中的当前 `recalled_at`，无需为未加载消息建立通用事件游标。本期不引入新的客户端持久化消息数据库或全局消息变更游标。

## 数据库变更

### 结论

本次不新增数据表，只为 `messages` 增加 `reply_to_message_id`。`attachments` 和 `outbox_events` 表均不增加字段。

上线前可审核的等价 DDL：

```sql
ALTER TABLE messages
  ADD COLUMN reply_to_message_id CHAR(36) NULL DEFAULT NULL;
```

### `messages` 新增字段

| 字段名 | 类型 | 是否为空 | 默认值 | 索引/约束 | 字段含义 |
| --- | --- | --- | --- | --- | --- |
| `reply_to_message_id` | `CHAR(36)` | 是 | `NULL` | 无 | 被回复消息的正式 `message_id`。发送时校验目标存在且属于同一会话；普通消息为空。 |

GORM entity 对应增加 nullable 字段：

```go
ReplyToMessageID *string `gorm:"column:reply_to_message_id;type:char(36)"`
```

实际字段顺序由 MySQL/GORM 迁移结果决定，不作为业务契约。实施时先在目标 MySQL 版本和近似数据量上审查 `AutoMigrate` 生成行为、锁表影响和索引创建耗时，再执行生产迁移。

`recalled_at` 以及反向引用索引仅在后续撤回能力确有需要时迁移，不属于本次 DDL。

### 数据库设计决策

- 不新增回复表。每条消息最多引用一条原消息，nullable 列足以表达关系。
- 不保存引用摘要快照。历史和实时 DTO 附带目标必要正文，由客户端生成摘要。后续撤回能力还需按原消息状态过滤正文。
- 不增加 `recalled_by_user_id`。本期只有原发送者可以撤回，发送者已经由 `sender_user_id` 确定。
- `recalled_at` 不单独建立索引。历史查询使用现有会话索引，状态校准使用唯一 `message_id`，没有按撤回时间扫描消息的需求。
- 本次不建 `reply_to_message_id` 反向索引；读取引用目标使用现有 `messages.message_id` 唯一索引。后续按原消息查全部回复时再评估索引。
- 不设置物理外键，保持当前 schema 使用业务事务维护消息关联的方式。服务端仍必须验证同会话关系。
- 数据库保留原 `content`，便于内部审计和一致性；所有对外 DTO mapper、附件授权和转发入口必须以 `recalled_at` 为准隐藏或拒绝原内容。
- `attachments` 不增加字段。签发下载授权时联查其 `message_id` 对应消息的 `recalled_at`；非空时拒绝授权。
- `outbox_events` 不增加字段。使用现有 `type`、`payload` 和 `created_at` 保存 `message_recalled` append-only 事件。
- 撤回事务只更新 `messages.recalled_at` 和插入 outbox，不修改 `content`、`conversation_seq`、`conversations.last_seq` 或成员游标。
- 逻辑撤回不会清除已经写入数据库、旧 outbox/Kafka 事件、已签发 URL 或外部副本中的历史字节；本期保证的是新的客户端 DTO、UI、转发入口和下载授权不再提供这些内容。

## 失败处理与状态反馈

| 场景 | 客户端行为 |
| --- | --- |
| 图片尚未缓存或缓存损坏 | 查看器不打开空白图片；触发现有受限恢复，仍失败时显示“图片加载失败”。 |
| 复制图片或图文失败 | 菜单关闭后显示“复制失败，请重试”，不显示成功提示。 |
| 用户取消另存为 | 静默结束，不视为错误。 |
| 保存目标写入失败 | 显示“保存失败”，日志保留安全诊断信息，不向 UI 暴露内部源路径。 |
| 回复目标在发送前撤回 | 服务端拒绝发送，保留输入内容和回复条，提示“原消息已撤回”。 |
| 后续撤回能力接入后，取得源内容时消息已撤回 | 新下载授权失败，终止取得内容；已经完整取得的副本允许继续转发。 |
| 某张图片转发上传失败 | 不发送整条消息；保留转发任务的可重试状态。 |
| 撤回请求超时 | 不先在本地永久改为撤回；重试同一请求，服务端幂等返回最终状态。 |
| 实时撤回事件重复或晚于状态校准 | 以非空 `recalled_at` 为单调终态，不恢复正文。 |
| 批量状态校准失败 | 保留当前展示并标记待重试，不把未知状态当作未撤回。 |

## 测试规划

项目要求每个测试用例包含描述性注释，明确测试目标、构造方法、输入数据和预期行为。表驱动测试的每个独立场景也必须具备这四项说明。

### React/TypeScript

| 测试组 | 必须覆盖的场景 |
| --- | --- |
| 菜单 | 图片右键只开图片菜单；气泡非图片区域开消息菜单；撤回消息和空白处无菜单；点击外部、Escape、失焦和切换会话关闭；输入框默认菜单被禁止。 |
| 图片查看器 | 左键打开并复用独立窗口；图片顺序按消息和 blocks；首尾按钮禁用；缩放边界、旋转、下载和右键复制；撤回当前图片后切换或关闭。 |
| 图文剪贴板 | 中文、换行、HTML 特殊字符、纯文字、单图、多图和交错 blocks 往返；远程图片和脚本被忽略；纯文本 fallback 正确。 |
| 回复 | 回复状态条、取消、发送字段、引用摘要、80 字截断、图片计数、定位高亮、未加载提示及目标撤回。 |
| 转发 | 纯文本、混合图文、原顺序、新附件 ID、单目标限制、失败不发送、重试和现有草稿不被修改。 |
| 撤回 | 菜单权限、accepted 限制、accepted/rejected 处理、重复/乱序事件单调合并、所有引用摘要同步更新。 |
| 离线校准 | 按会话收集正文和引用 ID、100 条分批、部分失败保留状态、重连后旧消息变为撤回且不能被旧历史恢复。 |

组件行为使用 Vitest + React Testing Library，从用户可见文本、角色和操作断言；feature API 测试单独断言 HTTP/WebSocket/Tauri DTO，不在组件测试里重复 command 字符串。

### Tauri Rust

- viewer session 创建、替换、版本递增、撤回移除、首尾选择和退出清理。
- 缓存键到文件路径的边界检查，拒绝目录穿越和任意路径。
- JPEG、PNG、WebP 位图复制；不支持类型返回稳定错误。
- HTML 与纯文本同次写入、HTML fallback 读取及剪贴板后端失败映射。
- 保存取消、保存成功、目标写入失败和源缓存失效。
- main/viewer WebView2 默认菜单关闭的 Windows 集成验收。

平台剪贴板和原生保存对话框通过窄 adapter 测试领域行为；真实 Windows WebView2、系统剪贴板和文件对话框必须补桌面集成或人工验收，不能只依赖 jsdom 或 Rust mock。

### `im-chat` Rust

- 普通消息无引用、有效同会话回复、引用不存在、跨会话引用和已撤回引用。
- 相同幂等键和相同引用恢复成功；相同正文但不同引用返回冲突。
- 原发送者不限时撤回成功、他人撤回拒绝、不可见消息统一 not found、重复及并发撤回幂等且只产生一条事件。
- 撤回更新与 outbox 同事务；outbox 失败时 `recalled_at` 回滚。
- 撤回不修改 `conversations.last_seq`、`conversation_seq`、`delivered_seq` 或 `read_seq`。
- `message_created` 和 `message_recalled` 两种事件验证、Kafka 解析、同节点投递及跨节点转发。

### `im-api` Go

- `AutoMigrate` 后 `messages` 存在两个新列和引用索引，原有表及数据仍可读取。
- 历史页批量生成引用摘要，不产生逐消息查询；撤回正文和摘要不出现在响应中。
- 状态接口鉴权、成员校验、空数组、超过 100 条、去重、未知/跨会话 ID 和正常混合状态。
- 已撤回消息的附件下载授权被拒绝，活动消息不受影响。
- 领域错误在 HTTP 边界映射为稳定 code，未知内部错误不泄漏 SQL、路径、token 或 SDK 文本。

### 验证命令与桌面验收

实施完成后至少运行：

```text
cd im-client
npm test
npm run build

cd im-client/src-tauri
cargo test
cargo check

cd im-chat
cargo test
cargo check

cd im-api
go test ./...
go vet ./...
```

Windows 桌面验收必须包括：

1. main 和 viewer 所有非自定义区域均不出现系统右键菜单。
2. 独立查看器创建、复用、聚焦、关闭、退出登录和主窗口关闭生命周期正确。
3. 中文文字、多段文字和多张图片从 Whisper 复制后，在 Whisper 内粘贴仍保持顺序。
4. 单图片可以粘贴到支持位图的应用；另存为文件字节与缓存原图一致。
5. 旋转和缩放不修改复制或下载的原图。
6. 在线撤回、离线后重连撤回、跨节点撤回和引用摘要更新均符合协议。

## 实施与发布顺序

1. **数据库准备**：更新 Go entity，在测试数据库验证 `AutoMigrate` 和等价 DDL；先部署新增 nullable 列和索引。
2. **事件兼容**：先让所有 `im-chat` consumer、节点 RPC 和投递节点能解析但不产生 `message_recalled`，确认旧 `message_created` 不受影响。
3. **服务端能力**：部署回复验证、撤回事务与事件生产、历史 DTO、状态校准和附件授权限制。
4. **客户端能力**：部署新 DTO 合并、菜单、回复、转发、Tauri 剪贴板/保存和独立查看器。
5. **开启撤回入口**：确认服务端节点全部支持新事件后再让客户端显示撤回菜单，避免旧 consumer 无法解析事件。
6. **验收**：完成自动化验证及 Windows 桌面验收，再把本文状态从“待实施设计”更新为实际完成状态，并同步 `database-schema.md`、`message-ack-protocol.md`、`kafka-outbox-event-envelope.md` 和图片流程文档中的正式契约。

回滚客户端或服务端时可以保留两个 nullable 数据库列；它们不会影响旧消息写入。已经写出的 `message_recalled` 事件要求消费端保持向后兼容，因此事件兼容部署必须早于事件生产，不能晚于生产事件。

## 验收标准

- 图片和消息右键区域严格区分，系统默认菜单在全客户端被禁用。
- 查看器只浏览当前会话已加载图片，并完成前后切换、缩放、旋转、复制和另存为。
- 完整图文在 Whisper 内复制粘贴后顺序一致，外部不支持富文本时仍有纯文本 fallback。
- 回复在实时消息和历史消息中都保留引用关系，点击可定位已加载原消息。
- 转发为新的普通消息，所有图片使用目标会话的新附件 ID，现有草稿不受影响。
- 本人可以不限时撤回，其他人不能撤回；重复请求幂等，不产生重复 outbox。
- 撤回后历史 DTO、引用摘要、图片查看器、转发和新下载授权均不再暴露原内容。
- 在线成员通过 `message_recalled` 实时更新；离线客户端重连后通过批量状态接口校准旧消息。
- 数据库只修改 `messages` 表的两个字段和一个索引，没有新增表或其他字段。
- 所有相关自动化测试通过，并完成 Windows 桌面专项验收。

## 依据与可核验来源

### 项目内依据

- [数据库表结构规划](database-schema.md)
- [消息与回执协议](message-ack-protocol.md)
- [聊天图片消息流程](chat-image-message-flow.md)
- [聊天图片本地磁盘缓存方案](chat-image-disk-cache.md)
- [Kafka Outbox 事件封装](kafka-outbox-event-envelope.md)
- [Redis 路由与在线状态](redis-routing-presence.md)

### 官方资料

- Tauri WebviewWindow API：<https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/>
- Tauri command：<https://v2.tauri.app/develop/calling-rust/>
- Tauri capabilities：<https://v2.tauri.app/security/capabilities/>
- Microsoft WebView2 `ICoreWebView2Settings`：<https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings>
- Microsoft HTML Clipboard Format：<https://learn.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format>
- Chromium clipboard implementation：<https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/editing/commands/clipboard_commands.cc>

### 社区实现参考

- `arboard` Windows clipboard implementation：<https://github.com/1Password/arboard/blob/v3.6.1/src/platform/windows.rs>

社区实现只用于核对 Windows 剪贴板格式写入行为，不替代 Tauri、Microsoft 和 Chromium 的官方契约。特定 Windows WebView2 版本对 CF_HTML、多图 data URL 和粘贴事件的实际行为仍需按本文桌面验收步骤验证。

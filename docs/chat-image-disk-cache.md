# 聊天图片本地磁盘缓存方案

状态：待实施设计。本文记录已确认的实施范围，不表示功能已经完成。现有图片上传、附件授权和消息协议见 [聊天图片消息流程](chat-image-message-flow.md)。

## 目标与范围

Tauri 桌面客户端把成功下载的聊天图片保存到本机应用缓存目录。切换会话、更新消息列表和重启应用后，只要对应文件仍有效，就直接读取本地图片，减少重复申请下载授权和访问 OSS。

本期采用 **Rust 文件缓存 + SQLite 元数据索引 + Tauri asset 协议显示**。前端继续调用现有批量下载授权接口；Rust 负责查询本地缓存，以及下载、保存未命中的图片。

已确认的边界：

- 按配套客户端正常使用的流程设计，附件 ID 对应的图片内容沿用现有约定。本期不处理直接调用上传接口覆盖对象的情况，不增加内容版本、ETag 或内容哈希校验机制。
- 缓存命中时不重新校验用户是否有权访问图片；需要网络下载时仍走现有授权接口及其服务端校验。不新增缓存访问权限系统或加密机制。
- 暂不加入缓存清理机制：没有容量上限、LRU、TTL、退出清理、启动清扫或定期清理。缓存文件会持续积累；应用缓存目录被外部删除时可以重新下载。
- 服务端、用户、会话维度的命名空间只用于防止串数据，不构成权限控制。
- 文件损坏、下载失败时的本次操作回滚和按需恢复属于正确性处理，不引入后台清理任务。
- 浏览器开发模式保留网络加载与内存缓存回退，磁盘持久化仅在 Tauri 桌面环境提供。
- 本方案只持久化图片，不持久化消息历史。离线读取图片以界面已经取得对应消息元数据为前提，不承诺整个客户端可以离线打开历史会话。

## 当前实现依据

| 本地证据 | 当前行为及设计影响 |
| --- | --- |
| [`ChatPanel.tsx`](../im-client/src/features/chat/components/ChatPanel.tsx) | effect 对当前消息中的图片批量申请授权并下载，按签名到期安排刷新，清理时撤销 Blob URL。需要把图片资源生命周期移出面板。 |
| [`attachmentsApi.ts`](../im-client/src/features/chat/attachmentsApi.ts) | 已有批量授权方法和 `fetchSignedImage`；下载响应包含附件 ID、签名 URL、到期时间、类型、大小。保留批量授权封装。 |
| [`AuthenticatedPage.tsx`](../im-client/src/routes/AuthenticatedPage.tsx) | 已在登录页面装配跨聊天面板的头像资源缓存。图片资源协调器可在同一层装配。 |
| [`Cargo.toml`](../im-client/src-tauri/Cargo.toml)、[`lib.rs`](../im-client/src-tauri/src/lib.rs) | 当前后端主要负责配置和凭据，没有图片磁盘缓存、SQLite 或 HTTP 下载依赖；本方案需要新增实现和依赖。 |
| [`tauri.conf.json`](../im-client/src-tauri/tauri.conf.json)、[`capabilities/default.json`](../im-client/src-tauri/capabilities/default.json) | 当前未配置 asset 协议目录，CSP 为 `null`；不能假定本地图片 URL 已可用。 |
| [`attachments/service.go`](../im-api/internal/service/attachments/service.go) | 下载授权限制每批最多 10 个附件，并校验会话成员、附件所属会话和 `attached` 状态。本方案保留未命中下载时的这些行为。 |

## 读取流程

1. 前端从当前消息中提取并去重附件 ID，附上当前服务端、用户和会话标识。
2. 资源协调器先查本次登录期间已有的资源及进行中的任务；重复消费者共用一个任务。
3. 对尚未加载的附件，批量调用 Rust 缓存查询命令。Rust 查询 SQLite，并检查对应文件是否存在、是否为完整文件及大小是否匹配记录。
4. 命中项立即返回可显示的资源；不申请下载授权，不访问 OSS，不按签名到期刷新。
5. 前端把未命中的 ID 按最多 10 个一批调用现有 `requestDownloadAuthorizations`。
6. 前端把授权结果交给 Rust 下载命令。Rust 在下载前再次查询缓存、合并同键进行中的任务，避免查询与下载之间的竞态产生重复请求。
7. Rust 使用签名 URL 下载缺失图片，完成文件和索引提交后返回可显示资源。每张图片独立报告成功或失败，成功图片可以先显示。

签名 URL 仅是一次网络下载的凭据，不写成缓存主键，不作为缓存失效时间。文件已经完整落盘后，URL 过期不触发重新下载。

## 存储与索引

缓存根目录通过 Tauri `app_cache_dir()` 解析，使用专属 `chat-images` 子目录，不硬编码 Windows 用户目录。

示意布局如下，实际文件名编码在实现时保持确定性：

```text
<app_cache_dir>/chat-images/
  index.sqlite3
  files/<server-namespace>/<user-id>/<conversation-id>/<attachment-id>.<ext>
```

完整逻辑键为：`规范化服务端 API 地址 + user_id + conversation_id + attachment_id`。

- 服务端地址复用配置层的规范化规则，不能只保留 host 而丢弃协议、端口或 API 路径。
- 服务端命名空间使用适合文件名的确定性编码或摘要；这是路径编码，不是图片内容版本。SQLite 保留完整逻辑键并设置唯一约束。
- 用户、会话和附件标识由 Rust 校验、编码后生成路径；扩展名从支持的媒体类型映射得到，不使用原始上传文件名。
- Rust 校验最终文件和临时文件均处于专属缓存目录内；读取索引中的相对路径也必须检查。这是避免错误路径读写的 IO 边界，不新增业务访问权限。

SQLite 只保存索引，不存图片二进制、access token 或临时签名 URL。最小记录包括逻辑键、相对文件路径、媒体类型、已确认文件大小。暂不加入服务于清理的访问时间、过期时间等字段。

索引记录表示“已经完整写入的文件”。正在下载和失败项不作为可命中记录写入 SQLite，进行中的状态保留在内存任务表中。

## 文件提交与按需恢复

文件系统改名和 SQLite 事务不能构成一个跨系统原子事务，因此提交顺序和中断恢复必须明确：

1. 为本次下载在目标目录生成唯一 `.part` 文件，按流写入，不把整张图片转换为 Base64 经 IPC 传递。
2. 检查 HTTP 响应成功、下载实际字节数与授权中的 `size_bytes` 一致、媒体类型受支持，并遵循现有单张图片大小限制。类型声明和字节数检查不等于完整图片解码校验。
3. 完成写入、刷新并关闭文件，把 `.part` 改名为最终文件；最终文件和临时文件位于同一文件系统。
4. 文件提交成功后，再事务性写入 SQLite 记录。
5. 只有文件和索引都成功后，才向调用方报告持久化成功。

本次请求可观察到的下载失败、写入失败、改名失败或索引提交失败，应回滚本次产生的文件及未提交索引，避免返回假命中。回滚本身失败时保留失败结果；不因此引入目录扫描或后台任务。

中断场景按请求到具体附件时恢复：

| 情况 | 按需处理 |
| --- | --- |
| 索引存在，文件被外部删除或大小不匹配 | 当前条目按未命中处理，移除失效索引；下载成功后替换对应文件及记录。 |
| 最终文件存在，但索引不存在，例如改名后进程终止 | 不把孤立文件直接作为命中；本次请求重新下载并受控替换该目标文件，然后提交索引。 |
| 进程中断后留下 `.part` | 不作为命中读取。新请求创建自己的临时文件；本期不扫描、清理其他残留临时文件。 |
| 文件大小正确但浏览器解码失败 | 针对该键废弃记录并进行一次受限重新下载；修复后确保 WebView 实际重新读取文件，不能只重复设置相同 `src` 就认为已恢复；仍失败则显示失败状态，不持续重试。 |
| SQLite 无法读取、写入或检测到数据库损坏 | 不把索引异常当作命中，不自动删除整库。该次加载降级为已有网络 Blob 路径；后续访问可重新尝试磁盘能力。 |

不要声称上述顺序可以保证突然断电时文件和数据库永远一致；一致性由命中检查与按需恢复共同保证。

## 前端生命周期与失败处理

资源协调器的生命周期独立于 `ChatPanel`，按完整逻辑键维护资源和进行中的 Promise。Rust 端同样按键合并下载，以覆盖多个命令并发到达的情况。

- 切换会话只让旧界面的回调失效，使用请求代次或取消订阅避免旧结果写入新会话。已开始的共享下载可以完成并落盘。
- 同一张图片失败不撤销其他图片的成功结果；不要因一张失败而再次下载整批已成功图片。
- 自动恢复对单图设置有限预算，例如首次失败后最多自动重试一次。仅需要新签名时重新申请该图授权；持续失败展示可手动重试状态。收到整批授权接口错误时结束该批此次尝试，不无限拆分重试。
- 磁盘或 SQLite 失败可以回退到现有 `fetchSignedImage` 和 Blob URL，保证本次图片仍有机会显示。回退也是一次受预算限制的恢复尝试，不能与重新授权、下载重试组合成无限循环。
- 退出登录后销毁前端协调器，释放 Blob URL 和组件引用；不删除磁盘文件。同一账户重新登录仍可查询磁盘缓存。
- asset URL 不调用 `URL.revokeObjectURL`。浏览器回退等路径生成的 Blob URL 在切换会话后仍由协调器保留，以便切回时复用；协调器销毁，或单项失效且已无消费者时，再释放对应 Blob URL。这是运行时资源生命周期管理，不是磁盘清理机制。
- 草稿及发送中的 `previewUrl` 继续按现有优先级显示；收到消息 accepted 后，图片才按正式附件的查询、授权流程接入缓存，不改变上传确认流程。

纯 Vite 浏览器开发环境没有 Rust command，适配层应检测实际 Tauri 环境，选择内存缓存和现有网络加载路径。不得把正常的桌面 IPC 业务错误误判为“不在 Tauri”而掩盖问题。浏览器回退同样合并重复任务并移除按签名到期重下载的逻辑，但不承诺刷新页面后的持久化。

## 本地资源显示与 IPC 边界

使用 Tauri asset 协议让 `<img>` 直接读取本地完整文件，避免每次展示都通过 JSON IPC 复制图片内容。

- 在 Cargo 中启用 Tauri `protocol-asset` feature。
- 在 `tauri.conf.json` 启用 `app.security.assetProtocol`，scope 仅覆盖 `$APPCACHE/chat-images/files/**`，不开放整个磁盘或索引、临时文件所在的其他目录。临时文件与最终文件同目录时仍不得为临时文件返回资源 URL。
- 此 scope 是应用文件范围限制，不按当前用户动态收紧，不承担本期已排除的缓存访问权限控制。
- 若后续配置 CSP，应把本地 asset 来源加入 `img-src`；Windows 等平台的 `http://asset.localhost` 与其他平台的 `asset:` 形式按 Tauri 文档处理，不为图片直接放开所有来源。
- 对 React 业务组件暴露的结果为 `{ attachmentId, src, source }` 等稳定资源 DTO，不暴露供组件拼接的绝对路径或平台分支。`source` 区分 asset 与 Blob，供生命周期处理使用。
- `convertFileSrc` 是前端 Tauri API，不能在 Rust 中直接调用。Rust 内部 IPC 返回经过校验的完整文件定位信息，由 `attachmentCacheApi.ts` 调用 `convertFileSrc` 转成上述 `src`；路径仅在此适配边界使用，不成为 feature 公共接口。禁止组件自行拼接 `file://` URL，不为隐藏路径另造自定义协议。当前项目尚无此适配，需要新增。

asset URL 本身可能编码文件位置，以上约束旨在隔离平台实现细节，不承诺隐藏本地路径。

## 模块与接口职责

以下为拟新增边界，实施时按文件实际职责拆分，不预建无实现的空模块。

| 位置 | 职责 |
| --- | --- |
| `src/features/chat/attachmentResourceCache.ts` | 完整键、前端资源复用、Promise 合并、消费者生命周期和有限恢复流程。 |
| `src/features/chat/attachmentCacheApi.ts` | 封装批量查询与下载命令，Tauri 环境选择，资源 DTO 和 asset/Blob 适配。 |
| `src/features/chat/attachmentsApi.ts` | 保留批量下载授权和浏览器网络下载；删除无调用方后才移除旧定时刷新辅助函数。 |
| `src/features/chat/components/ChatPanel.tsx` | 订阅当前会话图片，展示加载/成功/失败及重试入口；不管理磁盘、SQLite 或签名刷新定时器。 |
| `src/routes/AuthenticatedPage.tsx` | 装配资源协调器，提供服务端与用户上下文，销毁前端资源。 |
| `src-tauri/src/commands/attachments.rs` | 批量查询、下载、按键失效的窄 command 入口与 DTO 映射，不实现具体 IO。 |
| `src-tauri/src/attachment_cache.rs` 及其子模块 | 缓存服务、任务合并、路径处理、文件提交；SQLite 索引和 HTTP 下载按职责拆到子模块。 |
| `src-tauri/src/lib.rs` | 装配托管缓存服务、HTTP client 和命令注册。 |

查询接口返回逐项命中/未命中；下载接口接收完整逻辑键和本次授权资料，返回逐项资源或失败结果。前端授权接口按原有规则批量调用，不移入 Rust，也不把 access token 持久化到图片索引。

Rust 可采用 `reqwest` 负责下载，采用 `rusqlite` 操作 SQLite。具体版本、TLS/SQLite 构建选项和异步运行方式在实施时结合当前锁文件与平台验证；本设计不固定未经验证的依赖版本。同步 SQLite/文件操作不得长时间阻塞界面或异步执行线程。

## 实施与验收

先完成文件缓存和索引服务，再接入窄 command 与本地 asset 配置，最后替换面板资源加载流程并验证浏览器回退。现有定时重下载只有在新流程接通后才能移除。

测试按项目 skills 组织：Rust 内部 IO/索引不变量在模块附近测试，前端 API 适配与协调器用 Vitest，面板用户行为用 React Testing Library，asset 协议由真实 Tauri 窗口验证。每个测试用例都必须注释目标、构造步骤、具体输入和预期行为。

| 测试目标 | 构造方法 | 输入数据 | 预期行为 |
| --- | --- | --- | --- |
| 首次下载与命中 | 空缓存加载后再次查询 | 同一用户、会话下的图片 A | 首次授权和 OSS GET 各一次；再次加载均为零，显示 A。 |
| 跨会话和重启复用 | 加载 A，切换另一会话后返回；重启并再次登录 | 相同完整逻辑键 | 命中磁盘，不申请授权、不 GET OSS。 |
| 签名过期不影响已下载文件 | 首次下载后推进时间超过签名到期时间 | 已缓存 A | 图片继续显示，无定时授权或下载。 |
| 防止串数据 | 构造同附件 ID、不同服务端/用户/会话 | 多组完整逻辑键 | 分别查询各自索引和路径，互不误命中；没有新增权限校验。 |
| 批量上限与去重 | 一个列表重复引用 A，并包含 11 个不同未命中图片 | A 两次及另外 10 图 | 授权按 10+1 分批；A 仅下载一次。 |
| 并发与切换回调 | 两个消费者同时读取 A，完成前切会话 | 同键请求与新会话 B | Rust 和前端均合并任务；A 完成可落盘，不写入 B 的界面状态。 |
| 部分失败和有限重试 | 批次中一图失败，其余成功；让失败持续 | A 成功、B 持续网络失败 | A 不重下；B 自动重试达到预算后停止，并可手动重试。 |
| 文件中断与索引顺序 | 注入写入/改名/索引提交失败，及改名后退出 | 对应故障点的 A | 不返回持久化成功；失败回滚或下次按需恢复，不出现半文件命中。 |
| 文件外部损坏 | 缓存后删除、截断文件；另构造同大小不可解码数据 | A 的三种损坏状态 | 缺失/大小异常按未命中恢复；解码失败仅受限重下，不循环。 |
| 索引不可用 | 注入 SQLite 打开/查询/提交失败 | 正常图片 A | 不误报命中，不自动删库；本次可按预算回退网络 Blob。 |
| 路径与协议 | 输入越界路径片段，并在真实桌面窗口加载合法资源 | 非法键、正常 PNG/JPEG/WebP | Rust 拒绝越界 IO；合法图片经 asset 显示，scope 不开放无关文件目录。 |
| 浏览器兼容 | 在纯 Vite 环境重复切换图片会话 | A、B、A | 无 Rust IPC 依赖；内存命中复用，Blob 最终释放。 |
| 无清理行为 | 缓存后退出、重启、等待任意时间 | 已缓存 A 和其他文件 | 本功能不删除完整缓存文件、不启动清扫任务、不执行 TTL/LRU。 |

实施完成时运行受影响的前端测试和构建、Rust 测试，并在 Windows Tauri 开发及打包运行环境验证本地 asset 显示和重启命中。仅完成本文不代表上述验收已经通过。

## 依据与参考

项目规范：

- [Tauri / React / TypeScript / Vite skill](../.agent/skills/tauri-react-typescript-vite/SKILL.md) 及其结构、IPC、测试 references。
- [Rust 代码组织](../.agent/skills/rust-code-organization/SKILL.md)、[Rust 测试组织](../.agent/skills/rust-testing/SKILL.md)。

官方资料：

- [Tauri PathResolver::app_cache_dir](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html#method.app_cache_dir)：应用缓存目录解析。
- [Tauri convertFileSrc](https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc)：本地路径转换为 WebView 可用 URL 及 asset 配置要求。
- [Tauri 配置参考](https://v2.tauri.app/reference/config/)：`app.security.assetProtocol`、scope 与 CSP。
- [Tauri Rust commands](https://tauri.app/develop/calling-rust/)：前端与 Rust 调用边界。
- [Tauri tests and mocking](https://tauri.app/develop/tests/mocking/)：前端 IPC 模拟。
- [reqwest Response::chunk](https://docs.rs/reqwest/latest/reqwest/struct.Response.html#method.chunk)：分块读取下载响应。
- [rusqlite](https://docs.rs/rusqlite/latest/rusqlite/)：Rust SQLite 访问能力。
- [SQLite Appropriate Uses](https://www.sqlite.org/whentouse.html)：SQLite 作为应用内本地存储的适用场景。

文件加 SQLite 的组合、提交顺序、命名空间和恢复预算是本项目方案选择，不是 Tauri 官方规定。

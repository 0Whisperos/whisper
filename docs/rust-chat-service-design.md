# Rust 聊天服务设计说明

## 1. 文档目的

本文整理 Whisper 项目中 Rust 聊天服务的职责、可靠消息链路、离线同步方式，以及围绕 Outbox、Kafka、送达和已读状态形成的设计结论。目标是先把聊天主链路的逻辑边界说清楚，为后续协议、数据表和实现计划提供依据。

本文描述的是当前已确认的架构方向，不代表相关聊天功能已经实现。Kafka Topic、分区数量、消息协议、数据库 DDL、重试参数、保留时间和部署参数将在后续专项设计中确定。

配套数据流图见 [Rust 聊天服务消息流](./rust-chat-service-flow.svg)。

## 2. 当前项目基础与服务边界

### 2.1 当前仓库现状

- `im-client` 是 Tauri 2、React、TypeScript、Vite 桌面客户端，依赖与脚本见 [`im-client/package.json`](../im-client/package.json) 和 [`im-client/src-tauri/Cargo.toml`](../im-client/src-tauri/Cargo.toml)。
- `im-server` 是 Go HTTP 服务，已经提供登录、退出路由，入口见 [`im-server/internal/serve/serve.go`](../im-server/internal/serve/serve.go) 和 [`im-server/internal/serve/auth.go`](../im-server/internal/serve/auth.go)。
- `im-server` 当前通过 GORM 连接 MySQL，见 [`im-server/internal/database/database.go`](../im-server/internal/database/database.go) 和 [`im-server/go.mod`](../im-server/go.mod)。
- Rust 聊天服务尚未落地。本文中的 Rust 模块名称代表职责，不预先固定 crate、文件或公开 API。

### 2.2 两类业务服务

第一阶段采用两个业务部署单元：Go IM HTTP API 服务（`im-api`）和 Rust 实时消息服务（`im-chat`）。

| 服务 | 主要职责 | 不承担的职责 |
| --- | --- | --- |
| `im-api` | 登录、刷新和退出；签发短期访问令牌；用户资料；好友申请与关系管理；API Outbox 发布 | 聊天会话、WebSocket 长连接、实时消息转发、聊天消息落盘 |
| `im-chat` | WebSocket 连接；访问令牌校验；聊天会话与成员；消息可靠落盘；Outbox 发布；Kafka 消费；在线投递；回执与离线同步 | 用户密码认证、好友关系工作流、音视频媒体转发 |

Go 服务计划签发短期 JWT，Rust 服务持有公钥并在本地验签。当前 `im-server` 已有认证功能，但认证模型如何迁移到“短期访问令牌 + 可撤销刷新会话”属于后续认证专项设计，本文不定义具体令牌字段与有效期。

`im-api` 接受好友申请后，在自己的数据库事务中写入好友关系和 API Outbox 事件；事件经 Kafka 发送给 `im-chat`，由 `im-chat` 创建并持有单聊会话。客户端通过 HTTPS 从 `im-api` 获取用户和好友数据，通过 WebSocket 直接从 `im-chat` 获取会话、历史消息和同步结果，`im-api` 不代理聊天数据。

两个服务共享一个 MySQL 实例，但使用不同的逻辑数据域和写入权限：`im-api` 拥有用户、认证会话、好友关系和 API Outbox；`im-chat` 拥有聊天会话、成员、消息、Chat Outbox 以及送达和已读游标。服务之间不跨域修改对方的数据表。

第一阶段单机部署，基础设施可由 Docker Compose 管理，业务进程保持便于本地调试。架构仍区分用户、设备和连接；第一阶段只开放单设备行为，但不把用户身份与某条 WebSocket 连接视为同一概念。

## 3. 可靠消息主链路

### 3.1 客户端发送与服务端确认

发送方通过 WebSocket 提交消息后，Rust 聊天服务依次完成身份校验、会话权限校验和消息格式校验。随后在**同一个 MySQL 事务**中写入：

1. `messages`：正式聊天消息，是消息历史的事实记录。
2. `outbox_events`：与该消息对应的待发布事件，初始发布状态为 `pending`。

只有两条记录都成功提交后，Rust 才能回复发送方“服务端已接收”。如果事务失败，两条记录都不应生效，也不能向客户端确认成功。

```text
发送方客户端
    │ WebSocket 发送消息
    ▼
Rust 消息处理逻辑
    │ 校验身份、权限和输入
    ▼
MySQL 同一事务
    ├─ 写 messages
    └─ 写 outbox_events(status = pending)
    │
    ▼
事务提交成功 ──> 回复“服务端已接收”
```

这里的“服务端已接收”只表示消息已经可靠写入 MySQL，不表示 Kafka 已经收到事件，也不表示接收方设备已经收到或读过消息。

### 3.2 为什么需要 Transactional Outbox

Transactional Outbox（事务性发件箱）是一种设计模式。在本方案里，Outbox 的具体载体是 MySQL 中的 `outbox_events` 表；它不是单独的软件、服务器或消息队列产品。

如果直接先写 MySQL、再调用 Kafka，进程可能在两步之间崩溃，形成“消息已落盘但事件没有发布”的不一致。把正式消息和待发布事件放进同一个本地数据库事务后，二者只能同时提交或同时回滚。Kafka 暂时不可用时，正式消息仍然安全存在，待发布事件可以稍后重试。

`outbox_events` 保存待发布业务事件及其发布进度，而不是“接收方是否收到消息”的状态。它可以包含发布所需的事件快照和关联标识，但不是第二份聊天历史。

### 3.3 Outbox Publisher 如何修改状态

Rust 聊天服务内运行 Outbox Publisher 后台任务：

1. 查询可发布的 `pending` 事件。
2. 通过 Kafka Producer 把事件发送给 Kafka Broker。
3. 等待事件满足已配置的 Kafka Producer 确认条件。
4. 收到确认后，由 **Outbox Publisher** 把对应记录更新为 `published` 并记录发布时间。

创建 `pending` 状态的是处理客户端消息的写入逻辑；修改为 `published` 的是成功执行发布的 Rust Outbox Publisher。接收方客户端、Kafka Consumer 和 Kafka Broker 都不会直接修改 MySQL 中的 Outbox 状态。

`published` 的唯一含义是：本次发布已经满足配置的 Kafka Producer 确认条件。确认强度取决于后续确定的 Producer `acks`、副本与 ISR 配置；`published` 本身不额外承诺尚未配置的持久性等级。它绝不表示接收方聊天服务已消费、接收方设备已送达或用户已读。

发布超时存在“Broker 可能已经收到，但 Publisher 没有拿到确认”的不确定性。此时不能贸然标记 `published`；Publisher 应保留可重试状态。重试可能产生重复事件，因此下游必须幂等处理。

## 4. Kafka 实时分发链路

### 4.1 Producer、Broker、Consumer 与 offset

本方案中各角色的含义如下：

| 概念 | 在消息链路中的职责 |
| --- | --- |
| Kafka Producer | Outbox Publisher 使用的发布客户端，把事件发给 Kafka |
| Kafka Broker | 接收并按 Topic/分区保存事件，满足配置的确认条件后向 Producer 响应 |
| Kafka Consumer | Rust 聊天服务中的消费逻辑，读取事件并尝试实时投递 |
| consumer offset | 某个消费者组已经处理到 Kafka 日志的哪个位置 |

Kafka Consumer 收到消息创建事件后，需要先按稳定的事件标识做幂等检查，再查找接收方的在线连接。接收方在线时，通过 WebSocket 推送；接收方不在线时，本次实时投递流程结束，但正式消息仍保存在 MySQL。只有事件完成幂等处理并完成本次投递决策后，Consumer 才能推进相应 offset，不能在处理开始前先行提交。具体采用逐条或批量提交、自动或手动提交，留待 Kafka 专项设计。

### 4.2 接收方离线时仍提交 offset

当 Consumer 确认接收方当前不在线时，仍然应提交相应的 consumer offset。这个动作表示：

> 该消费者组已经处理过这条实时通知，当前没有在线连接可供投递。

它不表示客户端已收到消息，也不修改客户端的送达游标。

不能因某个用户离线而长期不提交 offset。一个 Kafka 分区中通常可能包含多个会话或用户的事件；如果离线用户的事件一直阻塞消费，后续在线用户的实时消息也会受影响。Kafka 在这里承担低延迟事件分发，而不是每个用户的离线收件箱。

提交 offset 也不会让 Kafka 立即删除该事件。Kafka 依据 Topic 的保留时间或容量策略清理日志；consumer offset 只是消费者组的处理进度。具体 retention 参数尚未确定。

## 5. 三套必须分离的状态

消息链路中存在三类不同进度，不应复用一个状态字段：

| 状态 | 代表什么 | 由谁推进 |
| --- | --- | --- |
| Outbox `pending` / `published` | 发布是否已满足配置的 Kafka Producer 确认条件 | Rust Outbox Publisher |
| `delivered_seq` | 客户端已确认连续收到该会话的最大序号 | 客户端回执触发，Rust 回执逻辑持久化 |
| `read_seq` | 用户已确认阅读到该会话的最大序号 | 客户端已读上报触发，Rust 回执逻辑持久化 |

因此：

```text
Kafka 已消费 ≠ 客户端已送达 ≠ 用户已读
```

发送方所见状态也应据此区分：MySQL 事务提交后是“服务端已接收”；接收方设备返回回执后才是“已送达”；接收方上报阅读进度后才是“已读”。

## 6. 消息标识、排序与离线同步

### 6.1 `message_id` 与 `conversation_seq`

每条消息需要两个职责不同的标识：

- `message_id`：全局唯一，用于标识消息、关联事件和幂等处理。它不承担会话内连续排序职责。
- `conversation_seq`：在单个会话内单调递增，用于排序、发现缺口、分页同步和推进送达/已读游标。

不应假设普通 UUID 类型的 `message_id` 能准确表达会话内顺序。`conversation_seq` 的具体分配算法和并发策略属于后续数据模型专项设计。

第一阶段只开放单聊，但会话和成员状态按可扩展模型理解，使后续群聊不需要推翻消息主链路。

### 6.2 `delivered_seq` 与 `read_seq`

对于同一会话，设备可能已经收到消息，但用户尚未阅读。例如：

```text
delivered_seq = 120
read_seq      = 115
```

此时设备已经连续收到序号 120，但用户只读到 115。重新连接后应从 `delivered_seq` 之后补消息；如果错误地从 `read_seq` 补发，会重复发送已经送达但尚未阅读的消息。

作为单设备阶段的简化，第一阶段可按会话成员维护送达与已读进度，同时在协议概念中保留 `device_id`。这不是最终的多设备模型。未来支持多设备时，`delivered_seq` 应下沉到设备维度，因为不同设备接收进度不同；`read_seq` 是否在设备间共享，需要按届时产品语义确定。

### 6.3 离线用户重新上线

MySQL 的 `messages` 是正式消息历史来源。接收方离线期间，Kafka Consumer 仍处理并提交事件的 offset，但不会推进该用户的 `delivered_seq`。用户重新建立连接后，Rust 从 MySQL 查询各会话中 `conversation_seq > delivered_seq` 的消息并补发；客户端确认连续收到的最大序号后，服务端再推进 `delivered_seq`。

```text
用户离线
  ├─ Kafka Consumer 处理实时事件并提交 offset
  └─ delivered_seq 保持不变

用户上线
  ├─ 建立 WebSocket 连接
  ├─ 按 delivered_seq 从 MySQL 补齐
  ├─ 客户端按 conversation_seq 排序、去重和识别缺口
  └─ 客户端确认连续进度，服务端更新 delivered_seq
```

## 7. 故障、重复与竞态处理原则

### 7.1 Kafka 暂时不可用

- `messages` 与 `outbox_events` 的 MySQL 事务成功后，可以确认“服务端已接收”。
- Outbox 事件保持可重试状态，Publisher 在 Kafka 恢复后继续发布。
- Kafka 故障会影响实时分发延迟，但不应造成正式消息丢失。
- Publisher 的退避、最大并发与告警阈值留待专项设计。

### 7.2 重复发布与重复消费

Kafka 已接收事件后，Publisher 可能在更新 Outbox 前崩溃，恢复后再次发布同一事件。因此链路按“至少一次”思路设计，不能假设一个事件只出现一次。

- 事件需要稳定且唯一的事件标识。
- Producer 重试不应创建新的业务消息。
- Consumer 必须按事件标识或稳定业务标识实现幂等。
- WebSocket 重复推送时，客户端应按 `message_id` 去重。

去重记录的具体存储方式和生命周期尚未固定。

### 7.3 客户端断线

WebSocket 写入成功本身不足以证明客户端已处理消息。只有客户端回执才能推进 `delivered_seq`。推送途中断线时，不将消息标记为已送达；客户端重连后仍按 MySQL 中的送达游标补齐。

### 7.4 上线同步与实时消息竞态

用户上线同步历史时，新的 Kafka 实时事件可能同时到达。不能依赖“先完整同步、再开始实时推送”的脆弱时间窗口。客户端应以 `conversation_seq` 统一排序，以 `message_id` 去重，并在发现序号缺口时向服务端补取；只有连续序号都已收到时才推进 `delivered_seq`。

## 8. 第一阶段为何不拆独立落盘服务

职责独立不等于必须立即成为独立进程。第一阶段把 WebSocket 接入、消息应用逻辑、存储、Outbox 发布和 Kafka 消费组织成 Rust 聊天服务内部的聚焦模块，但只部署一个 Rust 业务进程。这样仍能保持边界清楚，又避免过早引入内部 RPC、跨服务超时、重试、部署、监控和版本协调。

以下条件真实出现时，再评估把消息写入或 Outbox 发布提取成独立服务：

- WebSocket 连接容量与消息写入吞吐需要独立扩缩容。
- 多个聊天网关需要共享统一的消息写入入口。
- 消息存储逻辑需要独立发布、独立维护或具备不同的可用性目标。
- 消息写入或 Outbox 发布已经成为经测量确认的性能瓶颈。

是否拆分必须基于运行指标与维护边界，而不是仅为了增加服务数量。

## 9. 语音消息与一对一音视频通话

### 9.1 语音消息

语音消息属于媒体消息，而不是实时语音通话。音频内容上传到对象存储，聊天消息只保存对象引用以及必要的媒体元数据，例如时长、大小和格式。具体上传授权、对象键、转码和生命周期策略尚未确定。

### 9.2 一对一音视频通话

一对一音视频采用 WebRTC：

- Rust 聊天服务负责鉴权，以及邀请、接受、拒绝、SDP 和 ICE 候选等信令转发。
- 音视频媒体优先由两个客户端直接传输，不经过 Rust 聊天服务。
- 无法建立直连时，使用 Coturn 提供 TURN 中继；Coturn 属于基础设施，不自行实现。

第一阶段只考虑一对一通话，不设计多人会议，也不建设独立 SFU 媒体服务。

## 10. FAQ：本次讨论中的疑问与结论

### Q1：是否需要单独写一个服务负责消息落盘？

第一阶段不需要。消息存储属于聊天领域，可先作为 Rust 聊天服务内的独立模块，与连接管理、Outbox 和投递模块保持代码边界。只有出现独立扩缩容、统一写入入口、独立发布维护或实际瓶颈时，再提取部署单元。

### Q2：Outbox 到底是什么？

Outbox 是 Transactional Outbox 设计模式在数据库中的载体；在本方案里就是 `outbox_events` 表。它保存待发布业务事件及其发布进度，不是独立产品，也不是 Kafka 的替代品，更不是第二份完整聊天历史。

### Q3：是否先把消息发到 Kafka，成功后才存 MySQL？

不是。Rust 首先在同一个 MySQL 事务中写入 `messages` 与 `outbox_events(pending)`。事务提交成功后才向发送方确认；Outbox Publisher 随后异步发布到 Kafka。

### Q4：谁把 Outbox 从 `pending` 改为 `published`？

Rust Outbox Publisher。它把事件发给 Kafka Producer，并在本次发布满足配置的 Kafka Producer 确认条件后更新数据库状态。确认等级需要在 Kafka 专项设计中确定；接收方不会修改 Outbox。

### Q5：`published` 是否表示接收方已经收到消息？

不是。`published` 只表示本次发布已满足配置的 Kafka Producer 确认条件，不额外承诺尚未配置的持久性等级。客户端是否收到由 `delivered_seq` 表示，用户是否阅读由 `read_seq` 表示。

### Q6：Rust 是否还需要后台逻辑监听 Kafka？

需要。Outbox Publisher 负责“MySQL 到 Kafka”；Kafka Consumer 负责“Kafka 到在线连接”。Consumer 消费事件、幂等检查、查找在线连接并尝试 WebSocket 推送。

### Q7：接收方离线时，Consumer 是否仍提交 Kafka offset？

是。Consumer 已经完成“检查实时投递条件”这一处理，就应提交 offset。离线消息由 MySQL 保存，并在用户上线时按游标同步；不能让一个离线用户阻塞同分区的后续事件。

### Q8：提交 offset 后，Kafka 是否立即删除消息？

不会。offset 只表示消费者组处理到哪里。Kafka 根据 Topic 的 retention 策略保留和清理日志，与某次 offset 提交不是同一个动作。

### Q9：用户重新登录时，应携带最后已读的消息 ID 吗？

不应只依赖最后已读消息，更不应假设普通 `message_id` 可排序。离线补齐应依据每个会话的 `delivered_seq`；`read_seq` 单独表示阅读进度。消息使用全局唯一 `message_id` 做标识和幂等，使用会话内递增 `conversation_seq` 做排序与游标。

### Q10：如果 Kafka 不可用，发送方能否收到服务端确认？

只要 `messages` 与 `outbox_events` 的 MySQL 事务已经提交，就可以确认“服务端已接收”。事件保持待发布并在 Kafka 恢复后重试；此时实时投递会延迟，但正式消息不应丢失。

### Q11：为什么 Kafka 事件和 WebSocket 消息可能重复？

Publisher 可能在 Kafka 已接收后、更新 Outbox 前崩溃，因而恢复后重复发布；Consumer 或 WebSocket 也可能因重试重复处理。服务端消费者按事件或业务标识幂等，客户端按 `message_id` 去重。

### Q12：语音消息和视频通话都由聊天服务传输吗？

不是。语音消息的音频文件走对象存储，Rust 处理携带对象引用的媒体消息。一对一音视频的媒体走 WebRTC，Rust 只转发信令；无法直连时由 Coturn 中继媒体。

## 11. 尚未固化的设计与依据

### 11.1 留待专项设计的内容

当前项目级 skills 没有覆盖消息队列领域。因此本文对 Kafka 与 Transactional Outbox 的采用，是结合已确认需求、当前仓库边界和官方资料形成的项目设计结论；它尚不构成项目内完整的 Kafka 实施规范。

以下内容需要在实现前专项设计并验证：

- Kafka Topic 规划、分区数量、分区键与 consumer group 规划。
- WebSocket 与 Kafka 的具体协议、事件 envelope 和版本兼容策略。
- `messages`、`outbox_events`、会话成员状态与幂等记录的具体 DDL。
- Publisher 扫描、锁定、批处理、退避和失败处置策略。
- Kafka retention、确认级别、部署拓扑与可观测性参数。
- 会话序号的并发分配算法、同步分页和设备游标模型。

### 11.2 本地项目依据

- [`AGENTS.md`](../AGENTS.md)：项目调查、技术栈路由、测试驱动与协作要求。
- [Rust 代码组织 skill](../.agent/skills/rust-code-organization/SKILL.md)：未来 Rust 服务按职责拆模块，入口保持聚焦。
- [Go 代码组织 skill](../.agent/skills/go-code-organization/SKILL.md)：Go 服务边界和领域 package 的组织依据。
- [Tauri / React / TypeScript / Vite skill](../.agent/skills/tauri-react-typescript-vite/SKILL.md)：客户端与 Tauri 边界的组织依据。
- [`im-server/internal/serve/serve.go`](../im-server/internal/serve/serve.go)：当前登录、退出 HTTP 路由。
- [`im-server/internal/database/database.go`](../im-server/internal/database/database.go)：当前 MySQL/GORM 连接实现。
- [`im-client/package.json`](../im-client/package.json)：当前 React、TypeScript、Vite 与 Tauri 前端依赖。

### 11.3 官方外部资料

- [Apache Kafka Design](https://kafka.apache.org/43/design/design/)：Kafka 日志、分区、消费位置及投递语义的官方设计说明。
- [WebRTC: TURN server](https://webrtc.org/getting-started/turn-server)：真实网络中使用 TURN 中继的官方入门说明。

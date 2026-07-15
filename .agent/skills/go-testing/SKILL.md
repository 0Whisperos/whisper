---
name: go-testing
description: Use when 在本项目中新增、修改或迁移 Go 测试，选择同包或外部测试 package、表驱动测试、testdata、集成测试、race 或 fuzz 策略。
---

# Go 测试组织

## 核心原则

测试位置和形式由被验证的行为决定。先检查当前 `go.mod`、已有 `_test.go`、测试依赖、CI 和外部服务启动方式；不要在没有证据时写死 testcontainers、build tag、覆盖率工具或 assertion library。

需要完整示例时，阅读 `references/test-examples.md`。

## 测试位置与 package

| 测试目标 | 推荐位置与 package | 目的 |
| --- | --- | --- |
| 未导出 helper、package 内部不变量 | 源码同目录，使用同名 package | 直接验证未导出实现，不为测试扩大可见性 |
| 导出 API 和消费者契约 | 源码同目录，优先使用 `<package>_test` | 只通过导出 API 做黑盒验证 |
| HTTP handler | handler 同目录，按是否需要内部状态选择同包或外部 package | 使用 `httptest` 验证可观察协议行为 |
| 跨 package 或外部依赖集成 | 紧邻拥有该边界的 package，或沿用仓库已有集成测试目录 | 验证真实协作，不重复单元测试细节 |

不要为了让外部测试访问内部实现而导出 helper。一个 package 可以同时有少量同包白盒测试和外部黑盒测试，但不要无理由混用。

## 必需测试注释

每个顶层测试、fuzz seed 场景和独立 `t.Run` 用例都必须包含描述性注释，明确：

1. 测试目标：验证什么。
2. 构造方法：如何搭建场景，步骤化说明。
3. 输入数据：具体输入是什么。
4. 预期行为：期望输出或副作用是什么。

表驱动测试不能用一个测试函数顶部的通用注释代替每行用例说明。每个 table row 前写出四项具体注释，或改成独立 `t.Run` 让注释与场景相邻。

## 表驱动与子测试

- 多个场景共享相同执行结构和断言形状时使用表驱动测试。
- 场景构造或期望行为差异很大时使用独立测试或独立 `t.Run`，不要把复杂分支塞进 table loop。
- 用例名称必须表达行为，不使用 `case1`、`valid` 等含糊名称。
- 只有测试没有共享可变状态、端口、环境变量或外部资源时才使用 `t.Parallel()`。

## Helper、fixture 与清理

- 测试 helper 调用 `t.Helper()`，让失败位置指向调用场景。
- 使用 `t.Cleanup()` 恢复环境、关闭 listener、容器或临时资源。
- Go 工具忽略 `testdata/`；需要文件 fixture 时优先放在被测 package 的 `testdata/`。
- 优先使用 `t.TempDir()`，不要把临时产物写进源码目录。
- 不用固定 `time.Sleep` 等待异步结果；通过 channel、事件或带超时的条件等待同步。

## 替身与集成测试

- 优先测试真实领域行为，只在 SMTP、Redis、时钟、随机源或网络等外部边界使用 fake/stub。
- 不要只断言 mock 调用次数；同时验证调用产生的可观察结果和错误契约。
- 集成测试使用真实 Redis、容器、进程或内存替代品，必须由当前依赖、CI 和目标行为决定。
- 只有仓库已有约定或隔离成本确实需要时才增加 build tag；不能默认所有集成测试都使用 `integration` tag。
- 需要外部环境而当前不可用时，可以明确 `t.Skip` 条件，但必须让常规单元测试仍可独立运行。

## Race、fuzz 与覆盖率

- 共享状态、goroutine、channel 或并发 handler 发生变化时运行 `go test -race ./...`。
- 解析器、编解码、协议输入和验证器适合 fuzz；先提供有意义的 seed，并保留发现问题的回归样例。
- 覆盖率用于发现未验证区域，不作为测试质量的替代指标。没有项目阈值时不要自行设定百分比门槛。

## 验证命令

优先沿用仓库已有 Makefile、任务脚本或 CI 命令。没有项目命令时，从受影响 module 的根目录运行：

```text
go test ./...
go vet ./...
```

按风险增加：

```text
go test -count=1 ./...
go test -race ./...
go test -fuzz=<Target> <package>
```

多 module 仓库逐个验证受影响 module。额外 tag、容器或环境变量必须以当前仓库证据为准。

## 常见错误

| 错误 | 处理 |
| --- | --- |
| 所有测试都用同包以访问内部实现 | 公开契约优先用外部 `_test` package |
| 一个通用注释覆盖整张测试表 | 每个独立场景写四项具体注释 |
| 默认引入 testcontainers 或 assertion library | 先检查依赖和真实集成目标 |
| 为测试导出生产 helper | 改用同包测试或通过公开行为验证 |
| 用 sleep 解决并发测试时序 | 使用可观察同步条件和明确超时 |
| 只验证 mock 被调用 | 断言用户或调用方可观察的结果 |

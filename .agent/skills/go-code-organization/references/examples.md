# Go 代码组织正反例

## 薄入口

推荐让入口只负责装配：

```go
package main

func main() {
	cfg := loadConfig()
	app := newApplication(cfg)
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
```

不要在 `main.go` 中同时实现路由、业务校验、Redis 访问和邮件发送。

## 按能力组织 package

当仓库证据表明只有一个 module 和一个服务时，可以从较小结构开始：

```text
service/
  go.mod
  main.go
  verification.go
  verification_test.go
  smtp.go
  redis.go
```

职责增长后再引入 `cmd/` 或 `internal/`。不要只因“微服务通常这样做”就预建多层目录。

## 接口由使用方定义

推荐在需要替代实现的使用方定义最小接口：

```go
package verification

type sender interface {
	SendCode(ctx context.Context, email, code string) error
}

type Service struct {
	sender sender
}
```

不要在实现 package 中提前导出包含大量方法的通用 `Mailer`、`Repository` 接口，除非已有调用方需要该契约。

## 不固定 module 布局

以下两种结构都可能合理，必须先看发布和依赖证据：

```text
# 单 module，多个二进制
go.mod
cmd/service-a/main.go
cmd/service-b/main.go
internal/...
```

```text
# 独立 module
services/service-a/go.mod
services/service-b/go.mod
go.work  # 仅在本地联合开发确有需要时
```

禁止仅凭“未来会有多个服务”直接选择第二种结构。

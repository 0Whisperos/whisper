# Whisper

以下 Compose 命令从仓库根目录执行；各应用请另开位于仓库根目录的终端启动。

## 启动中间件

```powershell
docker compose up -d mysql redis kafka kafka-init mysql-init kafka-connect
```

先启动中间件，再按下文完成数据库迁移和种子账号初始化，最后注册 Debezium connector：

```powershell
docker compose --profile init run --rm --no-deps debezium-init
```

初始化任务会等待 Connect 就绪并检查 connector 与 task 均为 `RUNNING`，成功后打印
`CDC connector is ready` 并退出；失败时查看 `docker compose logs kafka-connect`。

停止中间件：

```powershell
docker compose down
```

清空中间件数据：

```powershell
docker compose down -v
```

## 中间件连接信息

```text
MySQL: 127.0.0.1:3307
数据库: whisper
用户名: whisper
密码: root

Redis: 127.0.0.1:6379
用户名: whisper
密码: root

Kafka: 127.0.0.1:9092
用户名: whisper
密码: root
安全协议: SASL_PLAINTEXT
SASL 机制: PLAIN

Kafka Connect: http://127.0.0.1:8083
```

## 启动 API

创建 `im-api/config.local.yaml`，已有文件则核对配置：

```yaml
server:
  listen_addr: 127.0.0.1:8080

database:
  host: "127.0.0.1"
  port: 3307
  username: "whisper"
  password: "root"
  name: "whisper"
  charset: "utf8mb4"
  parse_time: true
  loc: "Local"
  timeout: "5s"
  read_timeout: "5s"
  write_timeout: "5s"

redis:
  host: "127.0.0.1"
  port: 6379
  username: "whisper"
  password: "root"
  db: 0
  dial_timeout: "5s"
  read_timeout: "3s"
  write_timeout: "3s"
  pool:
    pool_timeout: "4s"

auth:
  jwt_secret: "replace-with-your-local-secret"
  access_token_ttl: "15m"
  refresh_token_ttl: "720h"

cors:
  allowed_origins:
    - http://127.0.0.1:1420
    - http://tauri.localhost

seed:
  users:
    - account: "12345678"
      password: "root"
    - account: "12345679"
      password: "root"
```

将 `auth.jwt_secret` 替换为自己的密钥。执行数据库迁移和种子账号初始化：

```powershell
cd im-api
go run . migrate --config config.local.yaml
go run . seed --config config.local.yaml
```

回到仓库根目录的终端完成上文 CDC 注册，再在当前 `im-api` 终端启动 API：

```powershell
go run . serve --config config.local.yaml
```

## 启动 im-chat

首次启动将 `im-chat/config.toml.example` 复制为 `im-chat/config.toml`，填写与 API
相同的 `auth.jwt_secret`，核对中间件连接信息。Windows 构建需要 MSVC C++ Build Tools
和 CMake；CMake 未加入 `Path` 时，可将 `$env:CMAKE` 设置为实际 `cmake.exe` 的绝对路径。

```powershell
cd im-chat
cargo run --locked
```

## 启动客户端

```powershell
cd im-client
npm install
npm run tauri:dev
```

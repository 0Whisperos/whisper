# Whisper

## 启动中间件

```powershell
docker compose up -d mysql redis kafka kafka-init mysql-init kafka-connect
```

数据库表迁移完成后，注册 Debezium connector：

```powershell
docker compose --profile init up debezium-init
```

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
MySQL: 127.0.0.1:3306
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

创建 `im-api/config.local.yaml`：

```yaml
server:
  listen_addr: 127.0.0.1:8080

database:
  dsn: "whisper:root@tcp(127.0.0.1:3306)/whisper?parseTime=true"

redis:
  addr: "127.0.0.1:6379"
  username: "whisper"
  password: "root"

cors:
  allowed_origins:
    - http://127.0.0.1:1420
    - http://tauri.localhost

seed:
  account: "12345678"
  password: "root"
```

执行数据库迁移和种子账号初始化：

```powershell
cd im-api
go run . migrate --config config.local.yaml
go run . seed --config config.local.yaml
```

启动 API：

```powershell
go run . serve --config config.local.yaml
```

## 启动客户端

```powershell
cd im-client
npm install
npm run tauri:dev
```

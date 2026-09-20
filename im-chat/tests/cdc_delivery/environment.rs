use anyhow::{Context, Result, ensure};
use redis::IntoConnectionInfo;
use serde::Deserialize;
use sqlx::MySqlPool;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use std::fs::{self, File};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use uuid::Uuid;

#[derive(Deserialize)]
pub(super) struct Settings {
    pub(super) auth: Auth,
    pub(super) mysql: Mysql,
    pub(super) redis: Redis,
    pub(super) kafka: Kafka,
}

#[derive(Deserialize)]
pub(super) struct Auth {
    pub(super) jwt_secret: String,
}

#[derive(Deserialize)]
pub(super) struct Mysql {
    username: String,
    password: String,
    ip: String,
    port: u16,
    db: String,
}

#[derive(Deserialize)]
pub(super) struct Redis {
    username: String,
    password: String,
    ip: String,
    port: u16,
    db: i64,
}

#[derive(Deserialize)]
pub(super) struct Kafka {
    pub(super) bootstrap_servers: String,
    pub(super) topic: String,
    pub(super) group_id: String,
    pub(super) username: String,
    pub(super) password: String,
}

pub(super) struct TestServer {
    child: Child,
    pub(super) ws_url: String,
    pub(super) log_dir: PathBuf,
}

impl TestServer {
    pub(super) fn start() -> Result<(Self, Settings)> {
        let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .context("im-chat must be inside the repository")?
            .canonicalize()?;
        let path = std::env::var("IM_CHAT_CDC_CONFIG")
            .context("set IM_CHAT_CDC_CONFIG to a repository-local isolated config.toml; this test does not skip when explicitly run")?;
        let path = PathBuf::from(path)
            .canonicalize()
            .context("CDC config must exist")?;
        ensure!(
            path.starts_with(&repository),
            "CDC config must be inside the repository"
        );
        let raw = fs::read_to_string(path)?;
        let settings: Settings = toml::from_str(&raw).context("invalid CDC config")?;
        ensure!(
            settings.mysql.db.starts_with("whisper_cdc_test"),
            "CDC MySQL database must start with whisper_cdc_test; migrate it before running"
        );
        ensure!(
            settings.redis.db > 0,
            "use a dedicated nonzero Redis database for CDC tests"
        );
        ensure!(
            !settings.auth.jwt_secret.is_empty(),
            "CDC JWT secret must not be empty"
        );

        let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
        let ws_url = format!("ws://127.0.0.1:{port}/ws");
        let run_id = Uuid::new_v4().to_string();
        let log_dir = repository.join(".tmp").join("cdc-delivery").join(&run_id);
        fs::create_dir_all(&log_dir)?;
        let mut config: toml::Value = toml::from_str(&raw)?;
        config["server"]["ip"] = "127.0.0.1".into();
        config["server"]["port"] = i64::from(port).into();
        config["node"]["node_id"] = format!("cdc-test-{run_id}").into();
        config["node"]["public_ws_url"] = ws_url.clone().into();
        config["kafka"]["group_id"] = format!("cdc-test-{run_id}").into();
        let config_text = toml::to_string(&config)?;
        let settings = toml::from_str(&config_text)?;
        fs::write(log_dir.join("config.toml"), config_text)?;
        let executable = PathBuf::from(env!("CARGO_BIN_EXE_im-chat")).canonicalize()?;
        ensure!(
            executable.starts_with(&repository),
            "build the test binary inside the repository"
        );
        let child = Command::new(executable)
            .current_dir(&log_dir)
            .env("TEMP", &log_dir)
            .env("TMP", &log_dir)
            .stdout(Stdio::from(File::create(log_dir.join("stdout.log"))?))
            .stderr(Stdio::from(File::create(log_dir.join("stderr.log"))?))
            .spawn()
            .context("start im-chat binary")?;
        Ok((
            Self {
                child,
                ws_url,
                log_dir,
            },
            settings,
        ))
    }

    pub(super) fn check_running(&mut self) -> Result<()> {
        ensure!(
            self.child.try_wait()?.is_none(),
            "im-chat exited; see {}",
            self.log_dir.display()
        );
        Ok(())
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Mysql {
    pub(super) async fn connect(&self) -> Result<MySqlPool> {
        Ok(MySqlPoolOptions::new()
            .max_connections(4)
            .connect_with(
                MySqlConnectOptions::new()
                    .host(&self.ip)
                    .port(self.port)
                    .username(&self.username)
                    .password(&self.password)
                    .database(&self.db),
            )
            .await?)
    }
}

impl Redis {
    pub(super) fn client(&self) -> Result<redis::Client> {
        let settings = redis::RedisConnectionInfo::default()
            .set_db(self.db)
            .set_username(&self.username)
            .set_password(&self.password);
        let info = (self.ip.as_str(), self.port)
            .into_connection_info()?
            .set_redis_settings(settings);
        Ok(redis::Client::open(info)?)
    }
}

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;

pub(crate) const DEFAULT_API_BASE_URL: &str = "http://127.0.0.1:8080";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientConfig {
    pub(crate) api_base_url: String,
}

#[derive(Debug, Error)]
pub(crate) enum ConfigError {
    #[error("create configuration directory: {0}")]
    CreateDirectory(#[source] std::io::Error),

    #[error("write configuration file: {0}")]
    Write(#[source] std::io::Error),

    #[error("read configuration file: {0}")]
    Read(#[source] std::io::Error),

    #[error("parse configuration file: {0}")]
    Parse(#[source] serde_json::Error),

    #[error("serialize default configuration: {0}")]
    Serialize(#[source] serde_json::Error),

    #[error("api base url must be an absolute http or https url")]
    InvalidApiBaseUrl,
}

pub(crate) fn load_or_create(config_path: &Path) -> Result<ClientConfig, ConfigError> {
    let contents = match fs::read_to_string(config_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return create_default_config(config_path);
        }
        Err(error) => return Err(ConfigError::Read(error)),
    };
    let mut config: ClientConfig = serde_json::from_str(&contents).map_err(ConfigError::Parse)?;
    config.api_base_url = normalize_api_base_url(&config.api_base_url)?;
    Ok(config)
}

fn create_default_config(config_path: &Path) -> Result<ClientConfig, ConfigError> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(ConfigError::CreateDirectory)?;
    }
    let config = ClientConfig {
        api_base_url: DEFAULT_API_BASE_URL.to_owned(),
    };
    let contents = serde_json::to_string_pretty(&config).map_err(ConfigError::Serialize)?;
    fs::write(config_path, contents).map_err(ConfigError::Write)?;
    Ok(config)
}

fn normalize_api_base_url(value: &str) -> Result<String, ConfigError> {
    let url = Url::parse(value).map_err(|_| ConfigError::InvalidApiBaseUrl)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(ConfigError::InvalidApiBaseUrl);
    }
    Ok(value.trim_end_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{load_or_create, DEFAULT_API_BASE_URL};

    struct TestDirectory {
        path: PathBuf,
    }

    impl TestDirectory {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("whisper-client-config-{unique}"));
            fs::create_dir_all(&path).expect("create test directory");
            Self { path }
        }

        fn config_path(&self) -> PathBuf {
            self.path.join("config.json")
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_config(path: &Path, contents: &str) {
        fs::write(path, contents).expect("write test config");
    }

    #[test]
    fn creates_default_config_when_file_is_missing() {
        // 测试目标：验证首次启动会创建可用的默认客户端配置。
        // 构造方法：创建空的临时目录，不预先创建 config.json，再调用配置加载函数。
        // 输入数据：不存在的 config.json 路径。
        // 预期行为：返回默认 API 地址，并在磁盘写入包含该地址的 JSON 配置。
        let directory = TestDirectory::new();
        let config_path = directory.config_path();

        let config = load_or_create(&config_path).expect("load default config");

        assert_eq!(config.api_base_url, DEFAULT_API_BASE_URL);
        let contents = fs::read_to_string(config_path).expect("read generated config");
        assert!(contents.contains(DEFAULT_API_BASE_URL));
    }

    #[test]
    fn removes_trailing_slashes_from_valid_api_base_url() {
        // 测试目标：验证合法地址读取后会移除末尾斜杠，避免接口路径出现双斜杠。
        // 构造方法：在临时目录写入带两个末尾斜杠的合法 JSON 配置，再调用加载函数。
        // 输入数据：apiBaseUrl 为 http://127.0.0.1:8080//。
        // 预期行为：返回的 api_base_url 为 http://127.0.0.1:8080。
        let directory = TestDirectory::new();
        let config_path = directory.config_path();
        write_config(&config_path, r#"{"apiBaseUrl":"http://127.0.0.1:8080//"}"#);

        let config = load_or_create(&config_path).expect("load valid config");

        assert_eq!(config.api_base_url, "http://127.0.0.1:8080");
    }

    #[test]
    fn preserves_existing_file_when_json_is_invalid() {
        // 测试目标：验证损坏的用户配置不会被默认值覆盖。
        // 构造方法：在临时目录写入非法 JSON，记录原文后调用加载函数。
        // 输入数据：内容为 {invalid-json 的 config.json。
        // 预期行为：加载返回错误，文件内容仍与调用前完全一致。
        let directory = TestDirectory::new();
        let config_path = directory.config_path();
        let invalid_contents = "{invalid-json";
        write_config(&config_path, invalid_contents);

        assert!(load_or_create(&config_path).is_err());

        let contents = fs::read_to_string(config_path).expect("read invalid config");
        assert_eq!(contents, invalid_contents);
    }

    #[test]
    fn preserves_existing_file_when_url_scheme_is_not_http() {
        // 测试目标：验证非 HTTP/HTTPS 的 API 地址会被拒绝且不改写用户文件。
        // 构造方法：在临时目录写入 ftp 协议地址，记录原文后调用加载函数。
        // 输入数据：apiBaseUrl 为 ftp://127.0.0.1:8080。
        // 预期行为：加载返回错误，文件内容保持不变。
        let directory = TestDirectory::new();
        let config_path = directory.config_path();
        let invalid_contents = r#"{"apiBaseUrl":"ftp://127.0.0.1:8080"}"#;
        write_config(&config_path, invalid_contents);

        assert!(load_or_create(&config_path).is_err());

        let contents = fs::read_to_string(config_path).expect("read invalid config");
        assert_eq!(contents, invalid_contents);
    }
}

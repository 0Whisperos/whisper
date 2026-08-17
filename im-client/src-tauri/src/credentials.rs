use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum CredentialError {
    #[error("refresh token is empty")]
    EmptyRefreshToken,

    #[error("credential store is unavailable")]
    StoreUnavailable,
}

pub(crate) fn load_refresh_token() -> Result<Option<String>, CredentialError> {
    Err(CredentialError::StoreUnavailable)
}

pub(crate) fn save_refresh_token(refresh_token: &str) -> Result<(), CredentialError> {
    if refresh_token.trim().is_empty() {
        return Err(CredentialError::EmptyRefreshToken);
    }
    Err(CredentialError::StoreUnavailable)
}

pub(crate) fn delete_refresh_token() -> Result<(), CredentialError> {
    Err(CredentialError::StoreUnavailable)
}

pub(crate) fn map_credential_error(error: CredentialError) -> String {
    match error {
        CredentialError::EmptyRefreshToken => "invalid_refresh_token".to_owned(),
        CredentialError::StoreUnavailable => "credential_unavailable".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{delete_refresh_token, load_refresh_token, save_refresh_token, CredentialError};

    #[test]
    fn rejects_empty_refresh_token_before_touching_store() {
        // 测试目标：验证空 refresh token 会被本地凭证层拒绝。
        // 构造方法：直接调用 save_refresh_token，不依赖真实平台安全存储。
        // 输入数据：只包含空白字符的 refresh token。
        // 预期行为：返回 EmptyRefreshToken，而不是继续访问底层存储。
        let error = save_refresh_token("   ").unwrap_err();

        assert_eq!(error, CredentialError::EmptyRefreshToken);
    }

    #[test]
    fn returns_stable_unavailable_error_until_stronghold_is_configured() {
        // 测试目标：验证 Stronghold 依赖尚未接入时，凭证层返回稳定不可用错误。
        // 构造方法：分别调用读取、保存和删除函数。
        // 输入数据：读取无输入，保存 refresh-token，删除无输入。
        // 预期行为：三者都返回 StoreUnavailable，调用方不会看到路径或底层错误文本。
        assert_eq!(load_refresh_token().unwrap_err(), CredentialError::StoreUnavailable);
        assert_eq!(save_refresh_token("refresh-token").unwrap_err(), CredentialError::StoreUnavailable);
        assert_eq!(delete_refresh_token().unwrap_err(), CredentialError::StoreUnavailable);
    }
}

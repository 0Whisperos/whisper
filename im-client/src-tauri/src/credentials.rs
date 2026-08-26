use serde::{Deserialize, Serialize};
use thiserror::Error;

const REFRESH_TOKEN_SERVICE: &str = "com.whisper.client.auth.refresh_token";
const SAVED_USERS_SERVICE: &str = "com.whisper.client.auth.saved_users";
const SAVED_USERS_USERNAME: &str = "index";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedUser {
    pub(crate) user_id: u64,
    pub(crate) account: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum CredentialError {
    #[error("user id is invalid")]
    InvalidUserID,

    #[error("account is empty")]
    EmptyAccount,

    #[error("refresh token is empty")]
    EmptyRefreshToken,

    #[error("saved user index is invalid")]
    InvalidSavedUserIndex,

    #[error("credential store is unavailable")]
    StoreUnavailable,
}

#[derive(Debug, PartialEq, Eq)]
enum BackendError {
    NoEntry,
    Unavailable,
}

trait CredentialBackend {
    fn get_password(&self, service: &str, username: &str) -> Result<String, BackendError>;
    fn set_password(&self, service: &str, username: &str, password: &str) -> Result<(), BackendError>;
    fn delete_credential(&self, service: &str, username: &str) -> Result<(), BackendError>;
}

struct KeyringBackend;

impl CredentialBackend for KeyringBackend {
    fn get_password(&self, service: &str, username: &str) -> Result<String, BackendError> {
        entry(service, username)?.get_password().map_err(map_keyring_error)
    }

    fn set_password(&self, service: &str, username: &str, password: &str) -> Result<(), BackendError> {
        entry(service, username)?
            .set_password(password)
            .map_err(map_keyring_error)
    }

    fn delete_credential(&self, service: &str, username: &str) -> Result<(), BackendError> {
        entry(service, username)?
            .delete_credential()
            .map_err(map_keyring_error)
    }
}

pub(crate) fn list_saved_users() -> Result<Vec<SavedUser>, CredentialError> {
    list_saved_users_with(&KeyringBackend)
}

pub(crate) fn load_refresh_token(user_id: u64) -> Result<Option<String>, CredentialError> {
    load_refresh_token_with(&KeyringBackend, user_id)
}

pub(crate) fn save_refresh_token(user_id: u64, account: &str, refresh_token: &str) -> Result<(), CredentialError> {
    save_refresh_token_with(&KeyringBackend, user_id, account, refresh_token)
}

pub(crate) fn delete_refresh_token(user_id: u64) -> Result<(), CredentialError> {
    delete_refresh_token_with(&KeyringBackend, user_id)
}

pub(crate) fn map_credential_error(error: CredentialError) -> String {
    match error {
        CredentialError::InvalidUserID | CredentialError::EmptyAccount => "invalid_request".to_owned(),
        CredentialError::EmptyRefreshToken => "invalid_refresh_token".to_owned(),
        CredentialError::InvalidSavedUserIndex | CredentialError::StoreUnavailable => "credential_unavailable".to_owned(),
    }
}

fn list_saved_users_with(backend: &impl CredentialBackend) -> Result<Vec<SavedUser>, CredentialError> {
    match backend.get_password(SAVED_USERS_SERVICE, SAVED_USERS_USERNAME) {
        Ok(contents) => parse_saved_users(&contents),
        Err(BackendError::NoEntry) => Ok(Vec::new()),
        Err(BackendError::Unavailable) => Err(CredentialError::StoreUnavailable),
    }
}

fn load_refresh_token_with(backend: &impl CredentialBackend, user_id: u64) -> Result<Option<String>, CredentialError> {
    validate_user_id(user_id)?;
    match backend.get_password(REFRESH_TOKEN_SERVICE, &credential_username(user_id)) {
        Ok(refresh_token) => Ok(Some(refresh_token)),
        Err(BackendError::NoEntry) => Ok(None),
        Err(BackendError::Unavailable) => Err(CredentialError::StoreUnavailable),
    }
}

fn save_refresh_token_with(
    backend: &impl CredentialBackend,
    user_id: u64,
    account: &str,
    refresh_token: &str,
) -> Result<(), CredentialError> {
    validate_user_id(user_id)?;
    let account = validate_account(account)?;
    validate_refresh_token(refresh_token)?;

    backend
        .set_password(REFRESH_TOKEN_SERVICE, &credential_username(user_id), refresh_token)
        .map_err(map_backend_error)?;

    let mut users = list_saved_users_with(backend)?;
    users.retain(|user| user.user_id != user_id);
    users.push(SavedUser {
        user_id,
        account: account.to_owned(),
    });
    save_saved_users_with(backend, &users)
}

fn delete_refresh_token_with(backend: &impl CredentialBackend, user_id: u64) -> Result<(), CredentialError> {
    validate_user_id(user_id)?;

    match backend.delete_credential(REFRESH_TOKEN_SERVICE, &credential_username(user_id)) {
        Ok(()) | Err(BackendError::NoEntry) => {}
        Err(BackendError::Unavailable) => return Err(CredentialError::StoreUnavailable),
    }

    let mut users = list_saved_users_with(backend)?;
    users.retain(|user| user.user_id != user_id);
    save_saved_users_with(backend, &users)
}

fn save_saved_users_with(backend: &impl CredentialBackend, users: &[SavedUser]) -> Result<(), CredentialError> {
    if users.is_empty() {
        match backend.delete_credential(SAVED_USERS_SERVICE, SAVED_USERS_USERNAME) {
            Ok(()) | Err(BackendError::NoEntry) => return Ok(()),
            Err(BackendError::Unavailable) => return Err(CredentialError::StoreUnavailable),
        }
    }

    let contents = serde_json::to_string(users).map_err(|_| CredentialError::InvalidSavedUserIndex)?;
    backend
        .set_password(SAVED_USERS_SERVICE, SAVED_USERS_USERNAME, &contents)
        .map_err(map_backend_error)
}

fn parse_saved_users(contents: &str) -> Result<Vec<SavedUser>, CredentialError> {
    serde_json::from_str(contents).map_err(|_| CredentialError::InvalidSavedUserIndex)
}

fn validate_user_id(user_id: u64) -> Result<(), CredentialError> {
    if user_id == 0 {
        return Err(CredentialError::InvalidUserID);
    }
    Ok(())
}

fn validate_account(account: &str) -> Result<&str, CredentialError> {
    let account = account.trim();
    if account.is_empty() {
        return Err(CredentialError::EmptyAccount);
    }
    Ok(account)
}

fn validate_refresh_token(refresh_token: &str) -> Result<(), CredentialError> {
    if refresh_token.trim().is_empty() {
        return Err(CredentialError::EmptyRefreshToken);
    }
    Ok(())
}

fn credential_username(user_id: u64) -> String {
    user_id.to_string()
}

fn entry(service: &str, username: &str) -> Result<keyring::Entry, BackendError> {
    keyring::Entry::new(service, username).map_err(map_keyring_error)
}

fn map_keyring_error(error: keyring::Error) -> BackendError {
    match error {
        keyring::Error::NoEntry => BackendError::NoEntry,
        _ => BackendError::Unavailable,
    }
}

fn map_backend_error(error: BackendError) -> CredentialError {
    match error {
        BackendError::NoEntry | BackendError::Unavailable => CredentialError::StoreUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::HashMap};

    use super::{
        delete_refresh_token_with, list_saved_users_with, load_refresh_token_with, save_refresh_token_with, BackendError,
        CredentialBackend, CredentialError, SavedUser, REFRESH_TOKEN_SERVICE, SAVED_USERS_SERVICE, SAVED_USERS_USERNAME,
    };

    #[test]
    fn saves_refresh_token_and_saved_user_index() {
        // Test goal: verify saving a token writes the per-user credential and records the account in the saved-user index.
        // Construction: use an in-memory credential backend, call save_refresh_token_with, then read both the token and index.
        // Input data: user_id 20001, account 00123456, refresh token refresh-token.
        // Expected behavior: token is stored under username 20001 and list_saved_users returns the account label.
        let backend = MemoryBackend::default();

        save_refresh_token_with(&backend, 20001, "00123456", "refresh-token").unwrap();

        assert_eq!(
            backend.get_password(REFRESH_TOKEN_SERVICE, "20001").unwrap(),
            "refresh-token"
        );
        assert_eq!(
            list_saved_users_with(&backend).unwrap(),
            vec![SavedUser {
                user_id: 20001,
                account: "00123456".to_owned()
            }]
        );
    }

    #[test]
    fn updates_existing_saved_user_account_without_duplicate_index_entry() {
        // Test goal: verify saving the same user twice updates its account label instead of duplicating the user index entry.
        // Construction: use an in-memory backend and call save_refresh_token_with twice for the same user_id.
        // Input data: user_id 20001, accounts 00123456 then 00999999, refresh tokens old-refresh-token then new-refresh-token.
        // Expected behavior: the stored token is replaced and the index contains one entry with the latest account.
        let backend = MemoryBackend::default();

        save_refresh_token_with(&backend, 20001, "00123456", "old-refresh-token").unwrap();
        save_refresh_token_with(&backend, 20001, "00999999", "new-refresh-token").unwrap();

        assert_eq!(
            load_refresh_token_with(&backend, 20001).unwrap(),
            Some("new-refresh-token".to_owned())
        );
        assert_eq!(
            list_saved_users_with(&backend).unwrap(),
            vec![SavedUser {
                user_id: 20001,
                account: "00999999".to_owned()
            }]
        );
    }

    #[test]
    fn deletes_refresh_token_and_removes_saved_user_index_entry() {
        // Test goal: verify deleting a saved user removes both the per-user token and the saved-user index entry.
        // Construction: save two users in an in-memory backend, delete one user, then read the remaining token and index.
        // Input data: users 20001/00123456 and 20002/00999999, deleting user 20001.
        // Expected behavior: user 20001 has no token and the index still contains user 20002.
        let backend = MemoryBackend::default();
        save_refresh_token_with(&backend, 20001, "00123456", "refresh-token-a").unwrap();
        save_refresh_token_with(&backend, 20002, "00999999", "refresh-token-b").unwrap();

        delete_refresh_token_with(&backend, 20001).unwrap();

        assert_eq!(load_refresh_token_with(&backend, 20001).unwrap(), None);
        assert_eq!(
            list_saved_users_with(&backend).unwrap(),
            vec![SavedUser {
                user_id: 20002,
                account: "00999999".to_owned()
            }]
        );
    }

    #[test]
    fn returns_empty_saved_users_when_index_is_missing() {
        // Test goal: verify a fresh credential store has no saved users and does not report an error.
        // Construction: use an empty in-memory backend and call list_saved_users_with.
        // Input data: no saved user index credential.
        // Expected behavior: an empty saved-user list is returned.
        let backend = MemoryBackend::default();

        assert_eq!(list_saved_users_with(&backend).unwrap(), Vec::<SavedUser>::new());
    }

    #[test]
    fn rejects_empty_refresh_token_before_touching_store() {
        // Test goal: verify empty refresh tokens are rejected before writing to the credential backend.
        // Construction: use an in-memory backend and call save_refresh_token_with with whitespace token text.
        // Input data: user_id 20001, account 00123456, refresh token containing only spaces.
        // Expected behavior: EmptyRefreshToken is returned and no token credential is written.
        let backend = MemoryBackend::default();

        let error = save_refresh_token_with(&backend, 20001, "00123456", "   ").unwrap_err();

        assert_eq!(error, CredentialError::EmptyRefreshToken);
        assert_eq!(backend.get_password(REFRESH_TOKEN_SERVICE, "20001"), Err(BackendError::NoEntry));
    }

    #[test]
    fn maps_backend_failures_to_store_unavailable() {
        // Test goal: verify low-level credential backend failures are hidden behind the stable StoreUnavailable error.
        // Construction: use a backend that fails all operations and call list, load, save, and delete helpers.
        // Input data: user_id 20001, account 00123456, refresh token refresh-token.
        // Expected behavior: each operation returns StoreUnavailable instead of exposing backend details.
        let backend = FailingBackend;

        assert_eq!(list_saved_users_with(&backend).unwrap_err(), CredentialError::StoreUnavailable);
        assert_eq!(
            load_refresh_token_with(&backend, 20001).unwrap_err(),
            CredentialError::StoreUnavailable
        );
        assert_eq!(
            save_refresh_token_with(&backend, 20001, "00123456", "refresh-token").unwrap_err(),
            CredentialError::StoreUnavailable
        );
        assert_eq!(
            delete_refresh_token_with(&backend, 20001).unwrap_err(),
            CredentialError::StoreUnavailable
        );
    }

    #[test]
    fn deleting_last_user_removes_saved_user_index_credential() {
        // Test goal: verify deleting the final saved user removes the index credential instead of leaving an empty list password.
        // Construction: save one user in an in-memory backend, delete it, then inspect the index credential directly.
        // Input data: user 20001 with account 00123456 and refresh token refresh-token.
        // Expected behavior: the saved-user index credential is absent after deletion.
        let backend = MemoryBackend::default();
        save_refresh_token_with(&backend, 20001, "00123456", "refresh-token").unwrap();

        delete_refresh_token_with(&backend, 20001).unwrap();

        assert_eq!(
            backend.get_password(SAVED_USERS_SERVICE, SAVED_USERS_USERNAME),
            Err(BackendError::NoEntry)
        );
    }

    #[derive(Default)]
    struct MemoryBackend {
        values: RefCell<HashMap<(String, String), String>>,
    }

    impl CredentialBackend for MemoryBackend {
        fn get_password(&self, service: &str, username: &str) -> Result<String, BackendError> {
            self.values
                .borrow()
                .get(&(service.to_owned(), username.to_owned()))
                .cloned()
                .ok_or(BackendError::NoEntry)
        }

        fn set_password(&self, service: &str, username: &str, password: &str) -> Result<(), BackendError> {
            self.values
                .borrow_mut()
                .insert((service.to_owned(), username.to_owned()), password.to_owned());
            Ok(())
        }

        fn delete_credential(&self, service: &str, username: &str) -> Result<(), BackendError> {
            if self
                .values
                .borrow_mut()
                .remove(&(service.to_owned(), username.to_owned()))
                .is_some()
            {
                return Ok(());
            }
            Err(BackendError::NoEntry)
        }
    }

    struct FailingBackend;

    impl CredentialBackend for FailingBackend {
        fn get_password(&self, _service: &str, _username: &str) -> Result<String, BackendError> {
            Err(BackendError::Unavailable)
        }

        fn set_password(&self, _service: &str, _username: &str, _password: &str) -> Result<(), BackendError> {
            Err(BackendError::Unavailable)
        }

        fn delete_credential(&self, _service: &str, _username: &str) -> Result<(), BackendError> {
            Err(BackendError::Unavailable)
        }
    }
}

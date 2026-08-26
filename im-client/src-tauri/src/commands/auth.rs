#[tauri::command]
pub(crate) fn list_saved_users() -> Result<Vec<crate::credentials::SavedUser>, String> {
    crate::credentials::list_saved_users().map_err(crate::credentials::map_credential_error)
}

#[tauri::command]
pub(crate) fn load_saved_refresh_token(user_id: u64) -> Result<Option<String>, String> {
    crate::credentials::load_refresh_token(user_id).map_err(crate::credentials::map_credential_error)
}

#[tauri::command]
pub(crate) fn save_refresh_token(user_id: u64, account: String, refresh_token: String) -> Result<(), String> {
    crate::credentials::save_refresh_token(user_id, &account, &refresh_token).map_err(crate::credentials::map_credential_error)
}

#[tauri::command]
pub(crate) fn delete_refresh_token(user_id: u64) -> Result<(), String> {
    crate::credentials::delete_refresh_token(user_id).map_err(crate::credentials::map_credential_error)
}

#[tauri::command]
pub(crate) fn load_saved_refresh_token() -> Result<Option<String>, String> {
    crate::credentials::load_refresh_token().map_err(crate::credentials::map_credential_error)
}

#[tauri::command]
pub(crate) fn save_refresh_token(refresh_token: String) -> Result<(), String> {
    crate::credentials::save_refresh_token(&refresh_token).map_err(crate::credentials::map_credential_error)
}

#[tauri::command]
pub(crate) fn delete_refresh_token() -> Result<(), String> {
    crate::credentials::delete_refresh_token().map_err(crate::credentials::map_credential_error)
}

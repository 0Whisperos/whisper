use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientConfigDto {
    api_base_url: String,
}

#[tauri::command]
pub(crate) fn load_client_config(app: AppHandle) -> Result<ClientConfigDto, String> {
    let config_path = app
        .path()
        .app_config_dir()
        .map_err(|_| "client_config_unavailable".to_owned())?
        .join("config.json");
    let config = crate::config::load_or_create(&config_path)
        .map_err(|_| "client_config_unavailable".to_owned())?;

    Ok(ClientConfigDto {
        api_base_url: config.api_base_url,
    })
}

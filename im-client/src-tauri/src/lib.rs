mod commands;
mod config;
mod credentials;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::auth::list_saved_users,
            commands::auth::load_saved_refresh_token,
            commands::auth::save_refresh_token,
            commands::auth::delete_refresh_token,
            commands::config::load_client_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

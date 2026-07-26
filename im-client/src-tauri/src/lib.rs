mod commands;
mod config;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::config::load_client_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

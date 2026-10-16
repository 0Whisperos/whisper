mod attachment_cache;
mod commands;
mod config;
mod credentials;
mod platform;

pub fn run() {
    tauri::Builder::default()
        .plugin(platform::webview::context_menu_policy())
        .invoke_handler(tauri::generate_handler![
            commands::auth::list_saved_users,
            commands::auth::load_saved_refresh_token,
            commands::auth::save_refresh_token,
            commands::auth::delete_refresh_token,
            commands::config::load_client_config,
            commands::attachments::lookup_chat_image_cache,
            commands::attachments::download_chat_images,
            commands::attachments::invalidate_chat_image_cache
        ])
        .manage(attachment_cache::AttachmentCache::new())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

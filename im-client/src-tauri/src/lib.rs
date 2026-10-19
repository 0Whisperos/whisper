mod attachment_cache;
mod commands;
mod config;
mod credentials;
mod image_actions;
mod image_decode;
mod image_error;
mod image_viewer;
mod message_clipboard;
mod platform;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(platform::webview::context_menu_policy())
        .plugin(image_viewer::lifecycle_plugin())
        .invoke_handler(tauri::generate_handler![
            commands::auth::list_saved_users,
            commands::auth::load_saved_refresh_token,
            commands::auth::save_refresh_token,
            commands::auth::delete_refresh_token,
            commands::config::load_client_config,
            commands::attachments::lookup_chat_image_cache,
            commands::attachments::download_chat_images,
            commands::attachments::invalidate_chat_image_cache,
            commands::image_viewer::prepare_image_viewer_session,
            commands::image_viewer::get_image_viewer_session,
            commands::image_viewer::update_image_viewer_session,
            commands::image_viewer::select_image_viewer_image,
            commands::image_viewer::close_image_viewer_session,
            commands::clipboard::copy_chat_image,
            commands::clipboard::write_chat_message_clipboard,
            commands::clipboard::read_chat_clipboard_html,
            commands::image_export::save_chat_image
        ])
        .manage(attachment_cache::AttachmentCache::new())
        .manage(image_viewer::ViewerStore::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if window.label() == "main" {
                    window.state::<image_viewer::ViewerStore>().close_main();
                    if let Some(viewer) = window.get_webview_window(image_viewer::LABEL) {
                        let _ = viewer.destroy();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

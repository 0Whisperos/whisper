use tauri::{
    plugin::{Builder, TauriPlugin},
    Wry,
};

/// Install before any WebView is created, including the configured login/main window.
pub(crate) fn context_menu_policy() -> TauriPlugin<Wry> {
    Builder::new("webview-policy")
        .js_init_script_on_all_frames(
            "window.addEventListener('contextmenu', event => event.preventDefault(), true);",
        )
        .on_webview_ready(|webview| {
            #[cfg(windows)]
            if webview
                .with_webview(|platform| {
                    // The controller is accessed on its owning UI thread by with_webview.
                    let result = unsafe {
                        platform
                            .controller()
                            .CoreWebView2()
                            .and_then(|view| view.Settings())
                            .and_then(|settings| settings.SetAreDefaultContextMenusEnabled(false))
                    };
                    if result.is_err() {
                        eprintln!("failed to disable native WebView context menus");
                    }
                })
                .is_err()
            {
                eprintln!("failed to access native WebView settings");
            }
        })
        .build()
}

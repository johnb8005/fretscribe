//! Thin native shell. All audio capture + DSP + music theory runs in the
//! webview (TypeScript / Web Audio). Rust only hosts the window and makes
//! sure the webview is allowed to open the microphone.

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window missing");

            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
                window.with_webview(|wv| {
                    let view = wv.inner();
                    if let Some(settings) = WebViewExt::settings(&view) {
                        settings.set_enable_media_stream(true);
                        settings.set_enable_webaudio(true);
                    }
                    // Auto-grant mic permission requests (getUserMedia).
                    view.connect_permission_request(|_, request| {
                        request.allow();
                        true
                    });
                })?;
            }

            #[cfg(not(target_os = "linux"))]
            let _ = window;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

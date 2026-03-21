use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use tauri_specta::Event;

const STORE_FILE: &str = "app-preferences.json";
const THEME_KEY: &str = "theme";
const DEFAULT_THEME: &str = "system";

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type, tauri_specta::Event)]
pub struct AppPreferences {
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_theme() -> String {
    DEFAULT_THEME.to_string()
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: default_theme(),
        }
    }
}

#[tauri::command]
pub fn get_app_preferences(app: AppHandle) -> Result<AppPreferences, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open preferences store: {}", e))?;

    let theme = store
        .get(THEME_KEY)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(default_theme);

    Ok(AppPreferences { theme })
}

const VALID_THEMES: &[&str] = &["light", "dark", "system"];

#[tauri::command]
pub fn set_app_preferences(app: AppHandle, preferences: AppPreferences) -> Result<(), String> {
    if !VALID_THEMES.contains(&preferences.theme.as_str()) {
        return Err(format!("Invalid theme: {}", preferences.theme));
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open preferences store: {}", e))?;

    store.set(
        THEME_KEY,
        serde_json::Value::String(preferences.theme.clone()),
    );

    store
        .save()
        .map_err(|e| format!("Failed to save preferences: {}", e))?;

    // Emit event to all windows for cross-window sync
    preferences
        .emit(&app)
        .map_err(|e| format!("Failed to emit preferences event: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn open_preferences_window(app: AppHandle) -> Result<(), String> {
    // Singleton: if preferences window already exists, focus it
    if let Some(window) = app.get_webview_window("preferences") {
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus preferences window: {}", e))?;
        return Ok(());
    }

    let url = tauri::WebviewUrl::App("index.html?window=preferences".into());

    tauri::WebviewWindowBuilder::new(&app, "preferences", url)
        .title("Preferences")
        .inner_size(500.0, 300.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .build()
        .map_err(|e| format!("Failed to create preferences window: {}", e))?;

    Ok(())
}

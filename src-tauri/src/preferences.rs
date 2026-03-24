//! App-level preferences (theme, appearance) with persistent storage.
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use tauri_specta::Event;

const STORE_FILE: &str = "app-preferences.json";
const THEME_KEY: &str = "theme";
const DEFAULT_THEME: &str = "system";
const CONTEXT_INDICATOR_KEY: &str = "context_indicator_visibility";
const DEFAULT_CONTEXT_INDICATOR: &str = "threshold";

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
pub struct AppPreferences {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_context_indicator")]
    pub context_indicator_visibility: String,
}

fn default_theme() -> String {
    DEFAULT_THEME.to_string()
}

fn default_context_indicator() -> String {
    DEFAULT_CONTEXT_INDICATOR.to_string()
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            context_indicator_visibility: default_context_indicator(),
        }
    }
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands receive owned values from IPC
pub fn get_app_preferences(app: AppHandle) -> Result<AppPreferences, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open preferences store: {e}"))?;

    let theme = store
        .get(THEME_KEY)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(default_theme);

    let context_indicator_visibility = store
        .get(CONTEXT_INDICATOR_KEY)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(default_context_indicator);

    Ok(AppPreferences {
        theme,
        context_indicator_visibility,
    })
}

const VALID_THEMES: &[&str] = &["light", "dark", "system"];
const VALID_CONTEXT_INDICATORS: &[&str] = &["threshold", "always", "never"];

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands receive owned values from IPC
pub fn set_app_preferences(app: AppHandle, preferences: AppPreferences) -> Result<(), String> {
    if !VALID_THEMES.contains(&preferences.theme.as_str()) {
        return Err(format!("Invalid theme: {}", preferences.theme));
    }

    if !VALID_CONTEXT_INDICATORS.contains(&preferences.context_indicator_visibility.as_str()) {
        return Err(format!(
            "Invalid context indicator visibility: {}",
            preferences.context_indicator_visibility
        ));
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open preferences store: {e}"))?;

    store.set(
        THEME_KEY,
        serde_json::Value::String(preferences.theme.clone()),
    );

    store.set(
        CONTEXT_INDICATOR_KEY,
        serde_json::Value::String(preferences.context_indicator_visibility.clone()),
    );

    store
        .save()
        .map_err(|e| format!("Failed to save preferences: {e}"))?;

    // Emit event to all windows for cross-window sync
    preferences
        .emit(&app)
        .map_err(|e| format!("Failed to emit preferences event: {e}"))?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands receive owned values from IPC
pub fn open_preferences_window(app: AppHandle) -> Result<(), String> {
    // Singleton: if preferences window already exists, focus it
    if let Some(window) = app.get_webview_window("preferences") {
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus preferences window: {e}"))?;
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
        .map_err(|e| format!("Failed to create preferences window: {e}"))?;

    Ok(())
}

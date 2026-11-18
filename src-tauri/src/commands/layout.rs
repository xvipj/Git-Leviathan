use crate::error::AppError;
use crate::state;

#[tauri::command]
pub async fn load_layout(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    Ok(state::load_layout(&app))
}

#[tauri::command]
pub async fn save_layout(app: tauri::AppHandle, layout: serde_json::Value) -> Result<(), AppError> {
    state::save_layout(&app, &layout)
}

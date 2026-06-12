use axum::{extract::State, routing::get, Json, Router};
use lingua::LanguageDetector;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub detector: Arc<LanguageDetector>,
}

pub fn build_app(detector: Arc<LanguageDetector>) -> Router {
    let state = AppState { detector };
    Router::new()
        .route("/health", get(health))
        .with_state(state)
}

async fn health(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "model_loaded": true }))
}

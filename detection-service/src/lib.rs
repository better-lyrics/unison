use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use lingua::{Language, LanguageDetector};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub detector: Arc<LanguageDetector>,
}

#[derive(Deserialize)]
pub struct DetectRequest {
    pub text: String,
}

#[derive(Serialize)]
pub struct DetectResponse {
    pub iso6391: Option<String>,
    pub confidence: f64,
}

pub fn build_app(detector: Arc<LanguageDetector>) -> Router {
    let state = AppState { detector };
    Router::new()
        .route("/health", get(health))
        .route("/detect", post(detect))
        .with_state(state)
}

async fn health(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "model_loaded": true }))
}

async fn detect(
    State(state): State<AppState>,
    payload: Result<Json<DetectRequest>, JsonRejection>,
) -> Response {
    let Json(req) = match payload {
        Ok(json) => json,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid request body" })),
            )
                .into_response();
        }
    };
    if req.text.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "text must not be empty" })),
        )
            .into_response();
    }
    let result = detect_one(&state.detector, &req.text);
    (StatusCode::OK, Json(result)).into_response()
}

fn detect_one(detector: &LanguageDetector, text: &str) -> DetectResponse {
    let confidences = detector.compute_language_confidence_values(text);
    if let Some((lang, confidence)) = confidences.first() {
        DetectResponse {
            iso6391: Some(iso6391(lang)),
            confidence: *confidence,
        }
    } else {
        DetectResponse {
            iso6391: None,
            confidence: 0.0,
        }
    }
}

fn iso6391(lang: &Language) -> String {
    lang.iso_code_639_1().to_string().to_lowercase()
}

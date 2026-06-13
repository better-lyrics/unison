use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use lingua::{Language, LanguageDetector};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;

const MAX_BATCH_SIZE: usize = 200;

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

#[derive(Deserialize)]
pub struct BatchRequest {
    pub texts: Vec<String>,
}

#[derive(Serialize)]
pub struct BatchResponse {
    pub results: Vec<DetectResponse>,
}

pub fn build_app(detector: Arc<LanguageDetector>) -> Router {
    let state = AppState { detector };
    Router::new()
        .route("/health", get(health))
        .route("/detect", post(detect))
        .route("/detect/batch", post(detect_batch))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
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
    let detector = state.detector.clone();
    let text = req.text;
    let result = tokio::task::spawn_blocking(move || detect_one(&detector, &text))
        .await
        .expect("detection task panicked");
    (StatusCode::OK, Json(result)).into_response()
}

async fn detect_batch(
    State(state): State<AppState>,
    payload: Result<Json<BatchRequest>, JsonRejection>,
) -> Response {
    let req = match payload {
        Ok(Json(r)) => r,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid request body" })),
            )
                .into_response();
        }
    };
    if req.texts.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "texts must not be empty" })),
        )
            .into_response();
    }
    if req.texts.len() > MAX_BATCH_SIZE {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({ "error": "batch too large" })),
        )
            .into_response();
    }
    let detector = state.detector.clone();
    let texts = req.texts;
    let results = tokio::task::spawn_blocking(move || {
        texts
            .par_iter()
            .map(|t| {
                if t.trim().is_empty() {
                    DetectResponse {
                        iso6391: None,
                        confidence: 0.0,
                    }
                } else {
                    detect_one(&detector, t)
                }
            })
            .collect::<Vec<DetectResponse>>()
    })
    .await
    .expect("rayon task panicked");
    (StatusCode::OK, Json(BatchResponse { results })).into_response()
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
    lang.iso_code_639_1().to_string().to_ascii_lowercase()
}

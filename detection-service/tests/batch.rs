use axum::body::Body;
use axum::http::{Request, StatusCode};
use detection_service::build_app;
use http_body_util::BodyExt;
use lingua::{LanguageDetector, LanguageDetectorBuilder};
use std::sync::{Arc, OnceLock};
use tower::ServiceExt;

fn detector() -> Arc<LanguageDetector> {
    static DETECTOR: OnceLock<Arc<LanguageDetector>> = OnceLock::new();
    DETECTOR
        .get_or_init(|| Arc::new(LanguageDetectorBuilder::from_all_languages().build()))
        .clone()
}

async fn post_batch(texts: Vec<&str>) -> (StatusCode, serde_json::Value) {
    let app = build_app(detector());
    let body = serde_json::json!({ "texts": texts }).to_string();
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/detect/batch")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    (status, json)
}

#[tokio::test]
async fn batch_detects_mixed_languages() {
    let (status, json) = post_batch(vec![
        "안녕하세요 반갑습니다",
        "Hello world this is English",
        "Xin chào tôi tên là Nam",
    ])
    .await;
    assert_eq!(status, StatusCode::OK);
    let results = json["results"].as_array().unwrap();
    assert_eq!(results.len(), 3);
    assert_eq!(results[0]["iso6391"], "ko");
    assert_eq!(results[1]["iso6391"], "en");
    assert_eq!(results[2]["iso6391"], "vi");
}

#[tokio::test]
async fn empty_batch_returns_400() {
    let (status, json) = post_batch(vec![]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "texts must not be empty");
}

#[tokio::test]
async fn oversized_batch_returns_413() {
    let texts: Vec<&str> = std::iter::repeat("hello world").take(201).collect();
    let (status, json) = post_batch(texts).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(json["error"], "batch too large");
}

#[tokio::test]
async fn batch_handles_empty_text_in_batch() {
    let (status, json) = post_batch(vec!["Hello world", ""]).await;
    assert_eq!(status, StatusCode::OK);
    let results = json["results"].as_array().unwrap();
    assert_eq!(results[0]["iso6391"], "en");
    assert!(results[1]["iso6391"].is_null());
}

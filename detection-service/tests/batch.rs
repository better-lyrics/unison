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

// Inputs are kept long enough that lingua exceeds its confidence floor.
// Very short multi-word text (under ~5 words) can be under-determined
// and is handled in the main API via a confidence threshold, not here.
#[tokio::test]
async fn batch_detects_mixed_languages() {
    let (status, json) = post_batch(vec![
        "안녕하세요 반갑습니다",
        "Hello world this is English",
        "안녕하세요 좋은 아침입니다",
        "Xin chào tôi tên là Nam",
        "This is another English sentence",
        "こんにちは今日はいい天気ですね",
        "Bonjour je m'appelle Pierre",
        "Hola me llamo Carlos",
        "Hello again from English",
        "Xin chào lần nữa rất vui được gặp lại các bạn",
    ])
    .await;
    assert_eq!(status, StatusCode::OK);
    let results = json["results"].as_array().unwrap();
    assert_eq!(results.len(), 10);
    assert_eq!(results[0]["iso6391"], "ko");
    assert_eq!(results[1]["iso6391"], "en");
    assert_eq!(results[2]["iso6391"], "ko");
    assert_eq!(results[3]["iso6391"], "vi");
    assert_eq!(results[4]["iso6391"], "en");
    assert_eq!(results[5]["iso6391"], "ja");
    assert_eq!(results[6]["iso6391"], "fr");
    assert_eq!(results[7]["iso6391"], "es");
    assert_eq!(results[8]["iso6391"], "en");
    assert_eq!(results[9]["iso6391"], "vi");
}

#[tokio::test]
async fn empty_batch_returns_400() {
    let (status, json) = post_batch(vec![]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "texts must not be empty");
}

#[tokio::test]
async fn oversized_batch_returns_413() {
    let texts: Vec<&str> = std::iter::repeat_n("hello world", 201).collect();
    let (status, json) = post_batch(texts).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(json["error"], "batch too large");
}

#[tokio::test]
async fn batch_handles_empty_text_in_batch() {
    let (status, json) = post_batch(vec![
        "Hello world",
        "",
        "안녕하세요 반갑습니다",
        "   ",
        "Hola me llamo Carlos",
        "\n\t",
        "Xin chào tôi tên là Nam",
        "",
        "こんにちは今日はいい天気ですね",
        "  \n  ",
    ])
    .await;
    assert_eq!(status, StatusCode::OK);
    let results = json["results"].as_array().unwrap();
    assert_eq!(results.len(), 10);
    assert_eq!(results[0]["iso6391"], "en");
    assert!(results[1]["iso6391"].is_null());
    assert_eq!(results[2]["iso6391"], "ko");
    assert!(results[3]["iso6391"].is_null());
    assert_eq!(results[4]["iso6391"], "es");
    assert!(results[5]["iso6391"].is_null());
    assert_eq!(results[6]["iso6391"], "vi");
    assert!(results[7]["iso6391"].is_null());
    assert_eq!(results[8]["iso6391"], "ja");
    assert!(results[9]["iso6391"].is_null());
}

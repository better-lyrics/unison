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

async fn post_detect(text: &str) -> (StatusCode, serde_json::Value) {
    let app = build_app(detector());
    let body = serde_json::json!({ "text": text }).to_string();
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/detect")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, json)
}

#[tokio::test]
async fn detects_korean() {
    let (status, json) = post_detect("안녕하세요 반갑습니다 오늘 날씨가 좋네요").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["iso6391"], "ko");
    assert!(json["confidence"].as_f64().unwrap() > 0.5);
}

#[tokio::test]
async fn detects_hebrew() {
    let (status, json) = post_detect("שלום עולם ברוכים הבאים").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["iso6391"], "he");
}

#[tokio::test]
async fn detects_vietnamese() {
    let (status, json) = post_detect("Xin chào tôi tên là Nam rất vui được gặp bạn").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["iso6391"], "vi");
}

#[tokio::test]
async fn detects_japanese() {
    let (status, json) = post_detect("こんにちは今日はいい天気ですね").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["iso6391"], "ja");
}

#[tokio::test]
async fn detects_arabic() {
    let (status, json) = post_detect("مرحبا بالعالم اهلا وسهلا").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["iso6391"], "ar");
}

#[tokio::test]
async fn detects_english() {
    let (status, json) = post_detect("Hello world this is a regular sentence in English").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["iso6391"], "en");
}

#[tokio::test]
async fn empty_text_returns_400() {
    let (status, _) = post_detect("").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn missing_text_field_returns_400() {
    let app = build_app(detector());
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/detect")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

use axum::body::Body;
use axum::http::{Request, StatusCode};
use detection_service::build_app;
use http_body_util::BodyExt;
use lingua::{LanguageDetector, LanguageDetectorBuilder};
use std::sync::Arc;
use tower::ServiceExt;

fn build_detector() -> Arc<LanguageDetector> {
    Arc::new(LanguageDetectorBuilder::from_all_languages().build())
}

#[tokio::test]
async fn health_returns_ok() {
    let app = build_app(build_detector());
    let res = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
    assert_eq!(json["model_loaded"], true);
}

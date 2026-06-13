use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use lingua::LanguageDetectorBuilder;
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);

    info!("loading detector");
    let t0 = Instant::now();
    let detector = Arc::new(LanguageDetectorBuilder::from_all_languages().build());
    info!(ms = t0.elapsed().as_millis() as u64, "detector ready");

    let app = detection_service::build_app(detector);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await.expect("bind");
    info!(port = port, "listening");
    axum::serve(listener, app).await.expect("serve");
}

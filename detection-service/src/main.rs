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
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(error = %e, %addr, "bind failed");
            std::process::exit(1);
        }
    };
    info!(%addr, "listening");
    if let Err(e) = axum::serve(listener, app).await {
        tracing::error!(error = %e, "serve failed");
        std::process::exit(1);
    }
}

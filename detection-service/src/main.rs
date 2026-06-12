use lingua::LanguageDetectorBuilder;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);

    println!("loading detector");
    let detector = Arc::new(LanguageDetectorBuilder::from_all_languages().build());
    println!("detector ready");

    let app = detection_service::build_app(detector);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await.expect("bind");
    println!("listening on {addr}");
    axum::serve(listener, app).await.expect("serve");
}

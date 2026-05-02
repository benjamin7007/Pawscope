use anyhow::Result;
use clap::{Parser, Subcommand};
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "pawscope", version)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Serve {
        #[arg(long, default_value = "127.0.0.1:7777")]
        bind: String,
        #[arg(long, default_value_t = false)]
        no_open: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Serve { bind, no_open } => {
            let mut adapters: Vec<Arc<dyn pawscope_core::AgentAdapter>> = Vec::new();
            match pawscope_copilot::CopilotAdapter::new() {
                Ok(a) => adapters.push(Arc::new(a)),
                Err(e) => tracing::warn!("copilot adapter disabled: {e}"),
            }
            match pawscope_claude::ClaudeAdapter::new() {
                Ok(a) => adapters.push(Arc::new(a)),
                Err(e) => tracing::warn!("claude adapter disabled: {e}"),
            }
            match pawscope_codex::CodexAdapter::new() {
                Ok(a) => adapters.push(Arc::new(a)),
                Err(e) => tracing::warn!("codex adapter disabled: {e}"),
            }
            match pawscope_opencode::OpenCodeAdapter::new() {
                Ok(a) => adapters.push(Arc::new(a)),
                Err(e) => tracing::warn!("opencode adapter disabled: {e}"),
            }
            match pawscope_gemini::GeminiAdapter::new() {
                Ok(a) => adapters.push(Arc::new(a)),
                Err(e) => tracing::warn!("gemini adapter disabled: {e}"),
            }
            match pawscope_aider::AiderAdapter::new() {
                Ok(a) => adapters.push(Arc::new(a)),
                Err(e) => tracing::warn!("aider adapter disabled: {e}"),
            }
            tracing::info!("active adapters: {}", adapters.len());
            let adapter: Arc<dyn pawscope_core::AgentAdapter> =
                Arc::new(pawscope_server::MultiAdapter::new(adapters));
            let (router, state) = pawscope_server::build_app(adapter);
            pawscope_server::spawn_watcher(state);
            let listener = tokio::net::TcpListener::bind(&bind).await?;
            tracing::info!("listening on http://{bind}");
            if !no_open {
                let _ = open::that(format!("http://{bind}"));
            }
            axum::serve(listener, router).await?;
        }
    }
    Ok(())
}

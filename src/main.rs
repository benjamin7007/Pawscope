use anyhow::Result;
use clap::{Parser, Subcommand};
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "agent-lens", version)]
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
            let adapter = Arc::new(agent_lens_copilot::CopilotAdapter::new()?);
            let (router, state) = agent_lens_server::build_app(adapter);
            agent_lens_server::spawn_watcher(state);
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

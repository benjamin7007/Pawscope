use crate::AppState;
use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
};

pub async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |sock| handle(sock, s))
}

async fn handle(mut sock: WebSocket, state: AppState) {
    let mut rx = state.events.subscribe();
    while let Ok(ev) = rx.recv().await {
        if let Ok(msg) = serde_json::to_string(&ev) {
            if sock.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    }
}

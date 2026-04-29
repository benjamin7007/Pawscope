use crate::AppState;
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures::stream::Stream;
use std::{convert::Infallible, time::Duration};
use tokio_stream::{StreamExt, wrappers::BroadcastStream};

pub async fn sse_handler(
    State(s): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = s.events.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|res| {
        let ev = res.ok()?;
        let json = serde_json::to_string(&ev).ok()?;
        Some(Ok(Event::default().event("session").data(json)))
    });
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

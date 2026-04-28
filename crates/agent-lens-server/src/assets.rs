use axum::{
    http::{StatusCode, Uri},
    response::{IntoResponse, Response},
};
pub async fn static_handler(_: Uri) -> Response {
    (StatusCode::NOT_FOUND, "frontend not embedded yet").into_response()
}

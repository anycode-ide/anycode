use serde_json::{self, json};
use socketioxide::{extract::{Data, SocketRef, State}};
use tokio_util::sync::CancellationToken;
use tracing::info;
use crate::{app_state::{AppState, SocketData}};
use serde::{Deserialize, Serialize};
use crate::search::{dir_search, FileSearchResult};
use tokio::sync::mpsc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchRequest {
    pub pattern: String,
}

pub async fn handle_search(
    socket: SocketRef,
    Data(search_request): Data<SearchRequest>,
    state: State<AppState>
) {
    info!("Received handle_search {}", search_request.pattern);

    let sid = socket.id.as_str();
    let mut sockets_data = state.socket2data.lock().await;

    // Get the socket data
    let data = sockets_data
        .entry(sid.to_string())
        .or_insert_with(|| SocketData::default());

    // Cancel the previous search if any
    if let Some(cancel) = &data.search_cancel {
        cancel.cancel();
    }

    // Create the cancellation token
    let cancel = CancellationToken::new();
    // Save the cancel in the socket data
    data.search_cancel = Some(cancel.clone());

    // Prepare search, get the current directory and create channel to collect results
    let current_dir = std::env::current_dir().unwrap();
    let (result_tx, mut result_rx) = mpsc::channel::<FileSearchResult>(1000);
    let socket_clone = socket.clone();

    let start = std::time::Instant::now();

    // Start the search in the background
    tokio::spawn(async move {
        let search_result = dir_search(
            &current_dir, &search_request.pattern, cancel, result_tx
        ).await;

        if let Err(err) = search_result {
            eprintln!("Search failed: {}", err);
            let _ = socket_clone.emit("search:error", &json!({
                "error": "Search failed", "message": err.to_string()
            }));
        }
    });

    // Collect results and send them to the socket
    tokio::spawn(async move {

        let mut matches = 0;
        // In cancel case, the loop will be ended automatically
        while let Some(file_result) = result_rx.recv().await {
            let _ = socket.emit("search:result", &file_result);
            matches += file_result.matches.len();
        }

        let _ = socket.emit("search:end", &json!({
            "elapsed": start.elapsed().as_millis(),
            "matches": matches
        }));
    });
}

use axum::{
  http::{header, StatusCode, Uri},
  response::{Html, IntoResponse, Response},
  routing::Router,
};
use serde_json::{json, Value};
use socketioxide::{
    extract::{AckSender, Data, SocketRef, State},
    SocketIo,
};
use tower::ServiceBuilder;
use tower_http::{cors::CorsLayer, services::ServeDir};
use tracing::info;
use tracing_subscriber::FmtSubscriber;
use anyhow::Result;

mod code;
use code::Code;

mod config;
use config::Config;

mod utils;
use utils::is_ignored_dir;

mod lsp;
use lsp::LspManager;

use std::{path::PathBuf, sync::Arc};
use tokio::sync::{mpsc::Receiver, Mutex};
use std::collections::HashMap;
use tokio::sync::mpsc;

mod app_state;
use app_state::{AppState, SocketData};

mod handlers;
use handlers::{
    io_handler::*, 
    search_handler::*, 
    lsp_handler::*, 
    terminal_handler::*,
};

mod search;
mod terminal;

use lsp_types::PublishDiagnosticsParams;
use notify::{recommended_watcher, Event, RecursiveMode, Watcher};

async fn on_connect(socket: SocketRef, state: State<AppState>) {
    info!("Socket.IO connected: {:?} {:?}", socket.ns(), socket.id);

    socket.on("file:open", handle_file_open);
    socket.on("dir:list", handle_dir_list);
    socket.on("file:change", handle_change);
    socket.on("file:save", handle_file_save);
    socket.on("file:set", handle_file_set);
    socket.on("file:create", handle_create);
    socket.on("file:close", handle_file_close);

    socket.on("lsp:completion", handle_completion);
    socket.on("lsp:definition", handle_definition);
    socket.on("lsp:references", handle_references);
    socket.on("lsp:hover", handle_hover);

    socket.on("search:start", handle_search);

    socket.on("terminal:start", handle_terminal_start);
    socket.on("terminal:input", handle_terminal_input);
    socket.on("terminal:resize", handle_terminal_resize);
    socket.on("terminal:close", handle_terminal_close);
    socket.on("terminal:reconnect", handle_terminal_reconnect);
    
    socket.on_disconnect(on_disconnect)
}

async fn on_disconnect(socket: SocketRef, state: State<AppState>) {
    info!("Socket.IO disconnected: {}", socket.id);
}


fn build_app_state() -> (AppState, Receiver<PublishDiagnosticsParams>) {

    let config = crate::config::get();

    let (diagnostic_send,  diagnostic_recv) = mpsc::channel::<PublishDiagnosticsParams>(1);
    let mut lsp_manager = LspManager::new(config.clone());
    lsp_manager.set_diagnostics_sender(diagnostic_send);

    let lsp_manager = Arc::new(Mutex::new(lsp_manager));

    let file2code = Arc::new(Mutex::new(HashMap::new()));
    let socket2data = Arc::new(Mutex::new(HashMap::new()));
    let terminals = Arc::new(Mutex::new(HashMap::new())); 

    let state = AppState { 
        config, file2code, lsp_manager, socket2data, terminals 
    };

    (state, diagnostic_recv)
}

async fn handle_watch_event(
    path: &PathBuf, 
    event: &notify::Event, 
    socket: &Arc<SocketIo>,
    file2code: &Arc<Mutex<HashMap<String, Code>>>
) {
    println!("watch event: {:?}", event);
    
    match event.kind {
        notify::EventKind::Create(_) => {
            let _ = socket.emit("watcher:create", &(path, path.is_file())).await;
        },
        notify::EventKind::Remove(_) => {
            let _ = socket.emit("watcher:remove", &(path, path.is_file())).await; 
        },
        notify::EventKind::Modify(notify::event::ModifyKind::Data(_)) => {
            let _ = socket.emit("watcher:modify", &(path, path.is_file())).await; 

            let mut f2c = file2code.lock().await;
            match f2c.get_mut(path.to_str().unwrap()) {
                Some(file) => {
                    let _ = file.reload();
                },
                None => {},
            };
        },
        _ => {

        }
    }
}

static INDEX_HTML: &str = "index.html";

async fn static_handler(uri: Uri) -> impl IntoResponse {
    info!("static handler {:?}", uri.path());

    let path = uri.path().trim_start_matches('/');

    if path.is_empty() || path == INDEX_HTML {
        return index_html().await;
    }

    match crate::config::Dist::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => {
            if path.contains('.') {
                return not_found().await;
            }

            index_html().await
        }
    }
}

async fn index_html() -> Response {
  match crate::config::Dist::get(INDEX_HTML) {
    Some(content) => Html(content.data).into_response(),
    None => not_found().await,
  }
}

async fn not_found() -> Response {
  (StatusCode::NOT_FOUND, "404").into_response()
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();

    let (state, mut diagnostics_channel) = build_app_state();
    // let file2code = state.file2code.clone();

    let (layer, io) = SocketIo::builder().with_state(state).build_layer();
    let cors = ServiceBuilder::new().layer(CorsLayer::permissive()).layer(layer);

    let io = Arc::new(io);

    // Spawn a task to handle diagnostics
    let socket = io.clone();
    tokio::spawn(async move {
        while let Some(diagnostic_message) = diagnostics_channel.recv().await {
            // log2::debug!("diagnostic_message_json {}", diagnostic_message_json);
            let send_result = socket.emit("lsp:diagnostics", &diagnostic_message).await;
            match send_result {
                Ok(_) => {},
                Err(e) => {
                    tracing::error!("error while sending lsp:diagnostics {}", e);
                }
            }
        }
    });


    // let (watch_tx, mut watch_rx) = mpsc::channel::<notify::Result<Event>>(32);
    // let mut watcher = recommended_watcher(move |res| {
    //     let _ = watch_tx.blocking_send(res);
    // })?;

    // let dir = std::path::Path::new(".");
    // watcher.watch(dir, RecursiveMode::Recursive)?;

    // // Spawn a task to watch files and dirs changes and send events to the socket
    // let socket = io.clone();
    // tokio::spawn(async move {
    //     while let Some(res) = watch_rx.recv().await {
    //         match res {
    //             Ok(event) => {
    //                 for path in &event.paths {
    //                     if is_ignored_dir(path) { continue }
    //                     else { 
    //                         handle_watch_event(path, &event, &socket, &file2code).await
    //                     }
    //                 }
    //             },
    //             Err(e) => eprintln!("watch error: {:?}", e)
    //         }
    //     }
    // });

    io.ns("/", on_connect);

    let app = axum::Router::new()
        .fallback(static_handler)
        .with_state(io.clone())
        .layer(cors);

    let port = std::env::var("ANYCODE_PORT").unwrap_or("3000".to_string());
    let url = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(url).await?;

    println!("Starting anycode at http://localhost:{}", port);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}

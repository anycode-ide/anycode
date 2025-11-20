use serde_json::{self, json};
use socketioxide::{extract::{AckSender, Data, SocketRef, State}};
use tracing::info;
use crate::{app_state::{AppState,TerminalData}, terminal::Terminal};
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Arc};
use tokio::sync::{Mutex, mpsc};

const MAX_TERMINAL_BUFFER: usize = 500;


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalStartRequest {
    pub name: String,
    pub session: String,
    pub cmd: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

pub async fn handle_terminal_start(
    socket: SocketRef,
    Data(terminal_start_request): Data<TerminalStartRequest>,
    state: State<AppState>,
    ack: AckSender
) {
    info!("Received handle_terminal {:?}", terminal_start_request);

    let terminal_name = terminal_start_request.name.clone();
    let session_id = terminal_start_request.session.clone();
    let id = format!("{}-{}", session_id, terminal_name);

    if state.terminals.lock().await.contains_key(&id) {
        // let _ = socket.emit("terminal:error", "Terminal already exists");

        let terminal_data_opt = {
            let terminals = state.terminals.lock().await;
            terminals.get(&id).cloned()
        };
    
        if let Some(terminal_data) = terminal_data_opt {
            // Clear existing sockets and add the new one
            let mut sockets = terminal_data.sockets.lock().await;
            sockets.clear();
            sockets.push(socket);
    
            let _ = ack.send(&json!({ "success": true }));
            info!("Terminal {} reconnected successfully", terminal_name);
        } else {
            let _ = ack.send(&json!({ "success": false, "error": "Terminal not found" }));
            info!("Terminal {} not found for reconnection", terminal_name);
        }
        return;
    }

    // Get terminal dimensions
    let rows = terminal_start_request.rows.unwrap_or(30);
    let cols = terminal_start_request.cols.unwrap_or(80);

    // Create channel for terminal output
    let (output_tx, mut output_rx) = mpsc::channel::<String>(32);

    // Create terminal
    let term = Terminal::new(
        terminal_name.clone(), session_id.clone(),
        rows, cols, None, None, output_tx,
    ).await;

    let terminal = match term {
        Ok(terminal) => terminal,
        Err(e) => {
            let message = format!("Failed to create terminal: {}", e);
            let _ = socket.emit("terminal:error", &message);
            return;
        }
    };

    // Store sockets for this terminal
    let sockets = Arc::new(Mutex::new(vec![socket.clone()]));

    let buffer = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_TERMINAL_BUFFER)));

    // Create terminal data for app state
    let terminal_data = TerminalData {
        terminal: Arc::new(terminal),
        sockets: sockets.clone(),
        buffer: buffer.clone(),
    };

    // Spawn task to handle terminal output
    let tname = terminal_name.clone();
    let sockets_clone = sockets.clone();
    let buffer_clone = buffer.clone();
    tokio::spawn(async move {
        while let Some(output) = output_rx.recv().await {
            let channel = format!("terminal:data:{}", tname);
            let mut needs_buffer = false;

            {
                let sockets_guard = sockets_clone.lock().await;
                if sockets_guard.is_empty() {
                    needs_buffer = true;
                } else {
                    for socket in sockets_guard.iter() {
                        if !socket.connected() {
                            needs_buffer = true;
                            continue;
                        }

                        if socket.emit(&channel, &output).is_err() {
                            needs_buffer = true;
                        }
                    }
                }
            }

            if needs_buffer {
                let mut buffer_guard = buffer_clone.lock().await;
                buffer_guard.push_back(output.clone());
                while buffer_guard.len() > MAX_TERMINAL_BUFFER {
                    buffer_guard.pop_front();
                }
            }
        }
        info!("Terminal output handler finished for {}", tname);
    });

    // Store terminal in app state
    state.terminals.lock().await.insert(id, terminal_data);

    info!("Terminal {} started successfully", terminal_name);
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalInputRequest {
    pub name: String,
    pub input: String,
    pub session: String,
}

pub async fn handle_terminal_input(
    socket: SocketRef,
    Data(request): Data<TerminalInputRequest>,
    state: State<AppState>
) {
    info!("Received handle_terminal_input {:?}", request);

    let TerminalInputRequest { name, input, session } = request;
    let id = format!("{}-{}", session, name);
    
    let terminal_data_opt = {
        let terminals = state.terminals.lock().await;
        terminals.get(&id).cloned()
    };

    if let Some(terminal_data) = terminal_data_opt {
        // Send input to terminal
        let send_result = terminal_data.terminal.send_input(input).await;

        if let Err(e) = send_result {
            let e = format!("Failed to send input: {}", e);
            let _ = socket.emit("terminal:error", &e);
        }
    } else {
        let _ = socket.emit("terminal:error", "Terminal not found");
    }
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalResizeRequest {
    pub name: String,
    pub session: String,
    pub cols: u16,
    pub rows: u16,
}

pub async fn handle_terminal_resize(
    socket: SocketRef,
    Data(request): Data<TerminalResizeRequest>,
    state: State<AppState>
) {
    info!("Received handle_terminal_resize {:?}", request);
    let TerminalResizeRequest { name, session, cols, rows } = request;
    let id = format!("{}-{}", session, name);

    let terminal_data_opt = {
        let terminals = state.terminals.lock().await;
        terminals.get(&id).cloned()
    };

    if let Some(terminal_data) = terminal_data_opt {
        // resize terminal
        let resize_result = terminal_data.terminal.resize(cols, rows).await;

        if let Err(e) = resize_result {
            let e = format!("Failed to resize terminal: {}", e);
            let _ = socket.emit("terminal:error", &e);
        }
    } else {
        let _ = socket.emit("terminal:error", "Terminal not found");
    }
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalCloseRequest {
    pub name: String,
    pub session: String,
}

pub async fn handle_terminal_close(
    socket: SocketRef,
    Data(request): Data<TerminalCloseRequest>,
    state: State<AppState>
) {
    info!("Received handle_terminal_close {:?}", request);
    let TerminalCloseRequest { name, session } = request;
    let id = format!("{}-{}", session, name);

    let terminal_data_opt = {
        let mut terminals = state.terminals.lock().await;
        terminals.remove(&id)
    };

    if let Some(terminal_data) = terminal_data_opt {
        // kill terminal
        match terminal_data.terminal.kill().await {
            Ok(_) => {
                info!("Terminal {} closed successfully", name);
            }
            Err(e) => {
                let e = format!("Failed to kill terminal: {}", e);
                let _ = socket.emit("terminal:error", &e);
            }
        }
    } else {
        let _ = socket.emit("terminal:error", "Terminal not found");
    }
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalReconnectRequest {
    pub name: String,
    pub session: String,
}

pub async fn handle_terminal_reconnect(
    socket: SocketRef,
    Data(request): Data<TerminalReconnectRequest>,
    state: State<AppState>,
    ack: AckSender
) {
    info!("Received handle_terminal_reconnect {:?}", request);
    let TerminalReconnectRequest { name, session } = request;
    let id = format!("{}-{}", session, name);

    let terminal_data_opt = {
        let terminals = state.terminals.lock().await;
        terminals.get(&id).cloned()
    };

    if let Some(terminal_data) = terminal_data_opt {
        // Clear existing sockets and add the new one
        let mut sockets = terminal_data.sockets.lock().await;
        sockets.clear();
        sockets.push(socket.clone());

        let _ = ack.send(&json!({ "success": true }));
        info!("Terminal {} reconnected successfully", name);

        let buffered_output: Vec<String> = {
            let mut buffer_guard = terminal_data.buffer.lock().await;
            buffer_guard.drain(..).collect()
        };
        let buffered_output_len = buffered_output.len();
                
        // time sleep 100 milliseconds. TODO FIX THIS 
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        for chunk in buffered_output {
            let channel = format!("terminal:data:{}", name);
            let _ = socket.emit(channel, &chunk);
        }
        info!("Terminal {} reconnected with {} chunks of buffer successfully", 
            name, buffered_output_len);

    } else {
        let _ = ack.send(&json!({ "success": false, "error": "Terminal not found" }));
        info!("Terminal {} not found for reconnection", name);
    }
}
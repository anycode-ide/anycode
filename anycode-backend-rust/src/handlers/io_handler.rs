use serde_json::{self, json};
use socketioxide::{extract::{AckSender, Data, SocketRef, State}};
use tracing::{info, error};
use crate::{app_state::{AppState, SocketData}, code::Code};
use serde::{Deserialize, Serialize};
use crate::utils::{abs_file, is_ignored_path};
use crate::app_state::*;
use crate::error_ack;


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileOpenRequest {
    pub path: String,
}

pub async fn handle_file_open(
    socket: SocketRef,
    Data(request): Data<FileOpenRequest>,
    ack: AckSender,
    state: State<AppState>
) {
    info!("Received file:open: {:?}", request);

    let abs_path = match abs_file(&request.path) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request.path, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };
    
    let content = code.text.to_string();

    ack.send(&json!({
        "content": content, "path": request.path, "success": true 
    })).ok();

    let mut lsp_manager = state.lsp_manager.lock().await;
    if let Some(lsp) = lsp_manager.get(&code.lang).await {
        lsp.did_open(&code.lang, &abs_path, &content);
    } 

    let sid = socket.id.as_str().to_string();
    let mut sockets_data = state.socket2data.lock().await;
    let data = sockets_data.entry(sid).or_insert_with(SocketData::default);
    data.opened_files.insert(abs_path);
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DirOpenRequest {
    pub path: String,
}

pub async fn handle_dir_list(
    Data(request): Data<DirOpenRequest>,
    ack: AckSender,
    _state: State<AppState>
) {
    info!("Received dir:list: {:?}", request);

    let dir = match request.path.as_str().trim() {
        "" | "." | "./" => crate::utils::current_dir(),
        d => d.to_string(),
    };

    let abs_path = match abs_file(&dir) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &dir, "Failed to resolve directory: {:?}", e),
    };

    let name = crate::utils::file_name(&dir);
    let mut relative_path = crate::utils::relative_path(&dir);
    if relative_path.is_empty() {
        relative_path = ".".to_string();
    }

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => error_ack!(ack, &dir, "Failed to open directory: {:?}", e),
    };

    let mut files = Vec::new();
    let mut dirs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();

        if is_ignored_path(&path) {
            continue;
        }

        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if path.is_dir() {
                dirs.push(name.to_string());
            } else {
                files.push(name.to_string());
            }
        }
    }

    dirs.sort();
    files.sort();

    let message = json!({
        "files": files,
        "dirs": dirs,
        "name": name,
        "fullpath": abs_path,
        "relative_path": relative_path,
    });

    if let Err(err) = ack.send(&message) {
        error!("Failed to send acknowledgment: {:?}", err);
    }
}

pub async fn handle_file_close(
    socket: SocketRef,
    Data(file): Data<String>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received file:close: {:?}", file);

    let abs_path = match abs_file(&file) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &file, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    let mut lsp_manager = state.lsp_manager.lock().await;
    if let Some(lsp) = lsp_manager.get(&code.lang).await {
        lsp.did_close(&abs_path);
    }

    let sid = socket.id.as_str().to_string();
    let mut sockets_data = state.socket2data.lock().await;
    let data = sockets_data.entry(sid).or_insert_with(SocketData::default);
    data.opened_files.remove(&abs_path);
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEdit {
    pub file: String,
    pub operation: usize, // 0 insert, 1 remove
    pub start: usize,
    pub text: String,
}

pub async fn handle_file_edit(
    socket: SocketRef,
    Data(edit): Data<FileEdit>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received file:edit: {:?}", edit);

    let abs_path = match abs_file(&edit.file) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &edit.file, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    let mut lsp_manager = state.lsp_manager.lock().await;

    match edit.operation {
        0 /* insert */ => {
            code.insert_text2(&edit.text, edit.start);

            if let Some(lsp) = lsp_manager.get(&code.lang).await {
                let start_pos = code.position(edit.start);
                lsp.did_change(
                    start_pos.0, start_pos.1, start_pos.0, start_pos.1,
                    &abs_path, &edit.text
                ).await;
            }
        }
        1 /* remove */ => {
            let chars_count = edit.text.chars().count();
            let start_pos = code.position(edit.start);
            let end_pos = code.position(edit.start + chars_count);

            code.remove_text2(edit.start, edit.start + chars_count);

            if let Some(lsp) = lsp_manager.get(&code.lang).await {
                lsp.did_change(
                    start_pos.0, start_pos.1, end_pos.0, end_pos.1,
                    &abs_path, ""
                ).await;
            }
        }
        _ => {
            error!("Unknown edit operation: {}", edit.operation);
        }
    }

    socket.broadcast().emit("file:edit", &edit).await.ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSaveRequest {
    pub path: String,
}

pub async fn handle_file_save(
    _socket: SocketRef,
    Data(request): Data<FileSaveRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received file:save: {:?}", request.path);

    let abs_path = match abs_file(&request.path) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &request.path, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    if let Err(e) = code.save_file() {
        error_ack!(ack, &abs_path, "Failed to save file: {:?}", e);
    }

    info!("File saved successfully: {}", abs_path);

    let mut lsp_manager = state.lsp_manager.lock().await;
    if let Some(lsp) = lsp_manager.get(&code.lang).await {
        lsp.did_save(&abs_path, Some(&code.text.to_string()));
    }

    ack.send(&json!({ "success": true, "file": abs_path })).ok();
}



#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSetRequest {
    pub file: String, 
    pub text: String, 
}

pub async fn handle_file_set(
    socket: SocketRef,
    Data(file_set_request): Data<FileSetRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received file:set: {:?}", file_set_request);

    let abs_path = match abs_file(&file_set_request.file) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &file_set_request.file, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = f2c.entry(abs_path.clone()).or_insert_with(|| Code::new());

    code.set_file_name(abs_path.clone());
    code.ensure_file_exists().ok();
    code.set_text(&file_set_request.text);

    if let Err(e) = code.save_file() {
        error_ack!(ack, &abs_path, "Failed to set file: {:?}", e);
    }

    info!("File set successfully: {}", abs_path);

    let mut lsp_manager = state.lsp_manager.lock().await;
    if let Some(lsp) = lsp_manager.get(&code.lang).await {
        lsp.did_save(&abs_path, Some(&file_set_request.text));
    }

    socket.broadcast().emit(
        "file:changed",
        &(abs_path.clone(), file_set_request.text.clone())
    ).await.ok();

    ack.send(&json!({ "success": true, "file": abs_path })).ok();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateRequest {
    pub parent_path: String,
    pub name: String,
    pub is_file: bool,
}

pub async fn handle_create(
    socket: SocketRef,
    Data(request): Data<CreateRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received create: {:?}", request);
    
    let parent_path = &request.parent_path;
    let name = &request.name;
    let is_file = request.is_file;
    
    let full_path = if parent_path.is_empty() || parent_path == "." || parent_path == "./" {
        name.clone()
    } else {
        format!("{}/{}", parent_path, name)
    };

    // For relative paths, we need to join with current directory
    let full_path = if full_path.starts_with('/') {
        full_path
    } else {
        // Relative path, join with current directory
        let current_dir = std::env::current_dir().unwrap_or_default();
        current_dir.join(&full_path).to_string_lossy().to_string()
    };

    // Create parent directories if they don't exist
    let path_buf = std::path::PathBuf::from(&full_path);
    if let Some(parent) = path_buf.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            error_ack!(ack, &request.name, "Failed to create parent directories: {:?}", e);
        }
    }

    if is_file {
        // Create empty file
        match std::fs::File::create(&full_path) {
            Ok(_) => {
                info!("File created successfully: {}", full_path);
                let mut f2c = state.file2code.lock().await;
                let code = f2c.entry(full_path.clone()).or_insert_with_key(|key| {
                    Code::new()
                });
                code.set_file_name(full_path.clone());
                
                socket.broadcast().emit("file:created", &full_path).await.ok();
                ack.send(&json!({ "success": true, "file": full_path, "is_file": true })).ok();
            },
            Err(e) => {
                error_ack!(ack, &request.name, "Failed to create file: {:?}", e);
            }
        }
    } else {
        // Create directory
        match std::fs::create_dir(&full_path) {
            Ok(_) => {
                info!("Directory created successfully: {}", full_path);
                socket.broadcast().emit("dir:created", &full_path).await.ok();
                ack.send(&json!({ "success": true, "dir": full_path, "is_file": false })).ok();
            },
            Err(e) => {
                error_ack!(ack, &request.name, "Failed to create directory: {:?}", e);
            }
        }
    }
}
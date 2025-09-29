use serde_json::{self, json};
use socketioxide::{extract::{AckSender, Data, SocketRef, State}};
use tracing::{info, error};
use crate::{app_state::{AppState, SocketData}, code::Code};
use serde::{Deserialize, Serialize};

use crate::utils::{abs_file, is_ignored_path};

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
    let file = request.path;

    let file = match abs_file(&file) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            let response = json!({ "error": message, "path": file, "success": false });
            let _ = ack.send(&response);
            return;
        }
    };

    let mut f2c = state.file2code.lock().await;
    let code = f2c.entry(file.clone()).or_insert_with_key(|key| {
        Code::from_file(key, &state.config).unwrap()
    });
    
    let content = code.text.to_string();
    let response = json!({"content": content, "path": file, "success": true });
    let _ = ack.send(&response);

    if let Some(lsp) = state.lsp_manager.lock().await.get(&code.lang).await {
        lsp.did_open(&code.lang, &file, &code.text.to_string());
    }    

    let sid = socket.id.as_str();
    let mut sockets_data = state.socket2data.lock().await;
    
    let data = sockets_data
        .entry(sid.to_string())
        .or_insert_with(|| SocketData::default());

    data.opened_files.insert(file);
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
    let dir = request.path;

    let dir = match dir.as_str().trim() {
        "" => crate::utils::current_dir(),
        "." => crate::utils::current_dir(),
        "./" => crate::utils::current_dir(),
        d => d.to_string()
    };

    let fullpath = match abs_file(&dir) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            let _ = ack.send(&message);
            return;
        }
    };

    let name = crate::utils::file_name(&dir);
    let mut relative_path = crate::utils::relative_path(&dir);
    if relative_path == "" {
        relative_path = ".".to_string();
    }

    match std::fs::read_dir(&dir) {
        Ok(entries) => {
            let mut files = Vec::new();
            let mut dirs = Vec::new();

            for entry in entries {
                if let Ok(entry) = entry {
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
            }
            dirs.sort_by(|a, b| a.cmp(&b));
            files.sort_by(|a, b| a.cmp(&b));

            let message = json!({ 
                "files": files, "dirs": dirs, 
                "name": name, "fullpath": fullpath,
                "relative_path": relative_path
            });

            if let Err(err) = ack.send(&message) {
                error!("Failed to send acknowledgment: {:?}", err);
            }
        }
        Err(err) => {
            error!("Error reading directory {:?}: {:?}", dir, err);

            let error_message = json!({
                "error": format!("Failed to open directory: {:?}", err),
                "name": name,
                "fullpath": fullpath,
                "relative_path": relative_path
            });

            if let Err(err) = ack.send(&error_message) {
                error!("Failed to send error acknowledgment: {:?}", err);
            }
        }
    }
}

pub async fn handle_file_close(
    socket: SocketRef,
    Data(file): Data<String>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received file:close: {:?}", file);

    let file = match abs_file(&file) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            let _ = ack.send(&message);
            return;
        }
    };

    let mut f2c = state.file2code.lock().await;
    let code = f2c.entry(file.clone()).or_insert_with_key(|key| {
        Code::from_file(key, &state.config).unwrap()
    });
    
    if let Some(lsp) = state.lsp_manager.lock().await.get(&code.lang).await {
        lsp.did_close(&file);
    }

    let sid = socket.id.as_str();
    let mut sockets_data = state.socket2data.lock().await;
    
    let data = sockets_data
        .entry(sid.to_string())
        .or_insert_with(|| SocketData::default());

    data.opened_files.remove(&file);
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

    let file = match abs_file(&edit.file) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            let _ = ack.send(&message);
            return;
        }
    };

    let mut f2c = state.file2code.lock().await;
    let code = f2c.entry(file.clone()).or_insert_with_key(|key| {
        Code::from_file(key, &state.config).unwrap()
    });

    match edit.operation {
        0 /* "insert" */ => {
            code.insert_text2(&edit.text, edit.start);

            if let Some(lsp) = state.lsp_manager.lock().await.get(&code.lang).await {
                let start = code.position(edit.start);

                lsp.did_change(
                    start.0, start.1, start.0, start.1,
                    &file, &edit.text
                ).await;
            }
        }
        1 /* "remove" */ => {
            let chars_count = edit.text.chars().count();
            let start = code.position(edit.start);
            let end = code.position(edit.start + chars_count);
            
            code.remove_text2(edit.start, edit.start + chars_count);

            if let Some(lsp) = state.lsp_manager.lock().await.get(&code.lang).await {
                lsp.did_change(
                    start.0, start.1, end.0, end.1,
                    &file, ""
                ).await;
            }
        }
        _ => {}
    }

    socket.broadcast().emit("file:edit", &edit);
}

pub async fn handle_file_save(
    _socket: SocketRef,
    Data(file): Data<String>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received file:save: {:?}", file);

    let file = match abs_file(&file) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            let _ = ack.send(&message);
            return;
        }
    };

    let mut f2c = state.file2code.lock().await;
    let code = f2c.entry(file.clone()).or_insert_with_key(|key| {
        Code::from_file(key, &state.config).unwrap()
    });

    let saved = code.save_file();

    match saved {
        Ok(_) => {
            info!("File saved successfully: {}", file);

            if let Some(lsp) = state.lsp_manager.lock().await.get(&code.lang).await {
                lsp.did_save(&file, Some(&code.text.to_string()));
            }

            let response = json!({ "success": true, "file": file });
            let _ = ack.send(&response);
        }
        Err(e) => {
            let message = format!("Failed to save file: {:?}", e);
            error!("{}", message);
            let _ = ack.send(&message);
            return;
        }
    }
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

    let file = match abs_file(&file_set_request.file) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            ack.send(&message);
            return;
        }
    };

    let mut f2c = state.file2code.lock().await;
    let code = f2c.entry(file.clone()).or_insert_with_key(|key| {
        Code::new()
    });

    code.set_file_name(file.clone());
    code.ensure_file_exists();
    code.set_text(&file_set_request.text);

    match code.save_file() {
        Ok(_) =>  {
            info!("File set successfully: {}", file);

            if let Some(lsp) = state.lsp_manager.lock().await.get(&code.lang).await {
                lsp.did_save(&file, Some(&file_set_request.text));
            }

            let _ = socket.broadcast().emit(
                "file:changed",
                &(file.to_string(), file_set_request.text)
            );

            let response = json!({ "success": true, "file": file });
            let _ = ack.send(&response);
        },
        Err(e) => {
            let message = format!("Failed to set file: {:?}", e);
            error!("{}", message);
            let _ = ack.send(&message);
            return;
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateRequest {
    pub parent_path: String,
    pub name: String,
    pub is_file: bool,
}

pub async fn handle_create(
    socket: SocketRef,
    Data(create_request): Data<CreateRequest>,
    state: State<AppState>,
    ack: AckSender,
) {
    info!("Received create: {:?}", create_request);
    
    let parent_path = &create_request.parent_path;
    let name = &create_request.name;
    let is_file = create_request.is_file;
    
    let full_path = if parent_path.is_empty() || parent_path == "." || parent_path == "./" {
        name.clone()
    } else {
        format!("{}/{}", parent_path, name)
    };

    // For relative paths, we need to join with current directory
    let full_path = if full_path.starts_with('/') || full_path.starts_with("C:") {
        // Already absolute path
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
            let message = format!("Failed to create parent directories: {:?}", e);
            error!("{}", message);
            ack.send(&message);
            return;
        }
    }

    if is_file {
        // Create empty file
        match std::fs::File::create(&full_path) {
            Ok(_) => {
                info!("File created successfully: {}", full_path);
                
                // Add to file2code map
                let mut f2c = state.file2code.lock().await;
                let code = f2c.entry(full_path.clone()).or_insert_with_key(|key| {
                    Code::new()
                });
                code.set_file_name(full_path.clone());
                
                // Broadcast file creation event
                socket.broadcast().emit("file:created", &full_path);
                
                let response = json!({ "success": true, "file": full_path, "is_file": true });
                ack.send(&response);
            },
            Err(e) => {
                let message = format!("Failed to create file: {:?}", e);
                error!("{}", message);
                ack.send(&message);
                return;
            }
        }
    } else {
        // Create directory
        match std::fs::create_dir(&full_path) {
            Ok(_) => {
                info!("Directory created successfully: {}", full_path);
                
                // Broadcast directory creation event
                socket.broadcast().emit("dir:created", &full_path);
                
                let response = json!({ "success": true, "dir": full_path, "is_file": false });
                ack.send(&response);
            },
            Err(e) => {
                let message = format!("Failed to create directory: {:?}", e);
                error!("{}", message);
                ack.send(&message);
                return;
            }
        }
    }
}
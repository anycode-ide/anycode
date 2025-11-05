use serde::{Deserialize, Serialize};
use serde_json::{self, json};
use socketioxide::{extract::{AckSender, Data, State}};
use tracing::{info, error};
use crate::app_state::AppState;
use crate::app_state::*;
use crate::error_ack;
use crate::utils::abs_file;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompletionRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
}

pub async fn handle_completion(
    Data(request): Data<CompletionRequest>,
    ack: AckSender,
    state: State<AppState>
) {
    info!("handle_completion {:?}", request);
    let CompletionRequest { file, row, column } = request;

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

    let result = match lsp_manager.get(&code.lang).await {
        Some(lsp) => {
            lsp.completion(&abs_path, row, column).await
                .ok().unwrap_or_else(|| Vec::new())
        },
        None => Vec::new()
    };

    ack.send(&result).ok();
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HoverRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
}

pub async fn handle_hover(
    Data(request): Data<HoverRequest>,
    ack: AckSender,
    state: State<AppState>
) {
    info!("handle_completion {}", request.file);
    let HoverRequest { file, row, column } = request;

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
        match lsp.hover(&abs_path, row, column).await {
            Ok(hover) => {
                ack.send(&hover).ok();
            }
            Err(e) => {
                ack.send(&json!({ "error": format!("Hover request failed: {}", e) })).ok();
            }
        }
    }
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DefinitionRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
}

pub async fn handle_definition(
    Data(request): Data<DefinitionRequest>,
    ack: AckSender,
    state: State<AppState>
) {
    info!("handle_definition {}", request.file);
    let DefinitionRequest { file, row, column } = request;

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
    
    let result = match lsp_manager.get(&code.lang).await {
        Some(lsp) => {
            lsp.definition(&abs_path, row, column).await
                .ok().unwrap_or_else(|| Vec::new())
        },
        None => Vec::new()
    };

    ack.send(&result).ok();
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReferencesRequest {
    pub file: String,
    pub row: usize,
    pub column: usize,
}

pub async fn handle_references(
    Data(request): Data<ReferencesRequest>,
    ack: AckSender,
    state: State<AppState>
) {
    info!("handle_references {}", request.file);
    let ReferencesRequest { file, row, column } = request;

    let abs_path = match abs_file(&file) {
        Ok(p) => p,
        Err(e) => error_ack!(ack, &file, "Failed to resolve file: {:?}", e),
    };

    let mut f2c = state.file2code.lock().await;
    let code = match get_or_create_code(&mut f2c, &abs_path, &state.config) {
        Ok(c) => c,
        Err(e) => error_ack!(ack, &abs_path, "{:?}", e),
    };

    let result = match state.lsp_manager.lock().await.get(&code.lang).await {
        Some(lsp) => {
            lsp.references(&abs_path, row, column).await
                .ok().unwrap_or_else(|| Vec::new())
        },
        None => Vec::new()
    };

    ack.send(&json!({ "items": result })).ok();
}

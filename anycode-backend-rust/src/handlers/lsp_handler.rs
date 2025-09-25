use serde::{Deserialize, Serialize};
use serde_json::{self, json};
use socketioxide::{extract::{AckSender, Data, State}};
use tracing::{info, error};
use crate::{
    app_state::AppState, code::Code,
};

use lsp_types::{Hover, HoverContents};

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

    let file = match abs_file(&file) {
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
        Code::from_file(key, &state.config).unwrap()
    });

    let result = match state.lsp_manager.lock().await.get(&code.lang).await {
        Some(lsp) => {
            lsp.completion(&file, row, column).await
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
    let file = match abs_file(&request.file) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            ack.send(&message);
            return;
        }
    };

    let mut f2c = state.file2code.lock().await;

    let code = f2c.entry(request.file.clone()).or_insert_with_key(|key| {
        Code::from_file(key, &state.config).unwrap()
    });

    use serde_json::json;
    
    if let Some(lsp) = state.lsp_manager.lock().await.get(&code.lang).await {
        match lsp.hover(&file, request.row, request.column).await {
            Ok(hover) => {
                let _ = ack.send(&hover);
            }
            Err(e) => {
                let err_json = json!({ "error": format!("Hover request failed: {}", e) });
                let _ = ack.send(&err_json);
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

    let file = match abs_file(&request.file) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            ack.send(&message);
            return;
        }
    };

    let mut f2c = state.file2code.lock().await;

    let code = f2c.entry(request.file.clone()).or_insert_with_key(|key| {
        Code::from_file(key, &state.config).unwrap()
    });

    let result = match state.lsp_manager.lock().await.get(&code.lang).await {
        Some(lsp) => {
            lsp.definition(&file, request.row, request.column).await
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
    Data(references_request): Data<ReferencesRequest>,
    ack: AckSender,
    state: State<AppState>
) {
    info!("handle_references {}", references_request.file);

    let file = match abs_file(&references_request.file) {
        Ok(file) => file,
        Err(e) => {
            let message = format!("Failed to open file: {:?}", e);
            error!("{}", message);
            ack.send(&message);
            return;
        }
    };

    let mut f2c = state.file2code.lock().await;

    let code = f2c.entry(references_request.file.clone()).or_insert_with_key(|key| {
        Code::from_file(key, &state.config).unwrap()
    });

    let result = match state.lsp_manager.lock().await.get(&code.lang).await {
        Some(lsp) => {
            lsp.references(&file, references_request.row, references_request.column).await
                .ok().unwrap_or_else(|| Vec::new())
        },
        None => Vec::new()
    };

    let result = json!({ "items": result });
    ack.send(&result).ok();
}

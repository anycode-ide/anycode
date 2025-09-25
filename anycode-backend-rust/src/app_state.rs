use std::{sync::Arc, collections::HashMap};
use tokio::sync::Mutex;
use crate::code::Code;
use crate::config::Config;
use crate::lsp::LspManager;
use socketioxide::{extract::SocketRef};
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;
use crate::terminal::Terminal;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub file2code: Arc<Mutex<HashMap<String, Code>>>,
    pub lsp_manager: Arc<Mutex<LspManager>>,
    pub socket2data: Arc<Mutex<HashMap<String, SocketData>>>,
    pub terminals: Arc<Mutex<HashMap<String, TerminalData>>>,
}

#[derive(Clone, Default)]
pub struct SocketData {
    pub opened_files: HashSet<String>,
    pub search_cancel: Option<CancellationToken>,
}

#[derive(Clone)]
pub struct TerminalData {
    pub terminal: Arc<Terminal>,
    pub sockets: Arc<Mutex<Vec<SocketRef>>>,
}

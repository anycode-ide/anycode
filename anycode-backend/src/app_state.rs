use std::{collections::VecDeque, sync::Arc};
use tokio::sync::Mutex;
use crate::code::Code;
use crate::config::Config;
use crate::lsp::LspManager;
use socketioxide::{extract::SocketRef};
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;
use crate::terminal::Terminal;
use std::collections::hash_map::{HashMap, Entry};
use anyhow::{Result, anyhow};


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
    pub buffer: Arc<Mutex<VecDeque<String>>>,
}


#[macro_export]
macro_rules! error_ack {
    ($ack:expr, $path:expr, $msg:expr $(, $args:expr)*) => {{
        let message = format!($msg $(, $args)*);
        error!("{}", message);
        let response = json!({ "error": message, "path": $path, "success": false });
        let _ = $ack.send(&response);
        return;
    }};
}

pub fn get_or_create_code<'a>(
    f2c: &'a mut HashMap<String, Code>,
    path: &str,
    config: &Config,
) -> Result<&'a mut Code> {
    match f2c.entry(path.to_string()) {
        Entry::Occupied(o) => Ok(o.into_mut()),
        Entry::Vacant(v) => {
            let c = Code::from_file(path, config)
                .map_err(|e| anyhow!("Failed to load file {}: {:?}", path, e))?;
            Ok(v.insert(c))
        }
    }
}
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize, Child};
use tokio::sync::mpsc;
use std::io::{Read, Write};
use anyhow::Result;
use std::path::{Path, PathBuf};

pub struct Terminal {
    name: String,
    session_id: String,
    pty_input_tx: mpsc::Sender<String>,
    pty_resize_tx: mpsc::Sender<(u16, u16)>,
    kill_tx: mpsc::Sender<()>,
}

impl Terminal {
    pub async fn new(
        name: String,
        session_id: String,
        rows: u16,
        cols: u16,
        cmd: Option<String>,
        cwd: Option<PathBuf>,
        on_output_tx: mpsc::Sender<String>,
    ) -> anyhow::Result<Self> {
        let pty_system = native_pty_system();
        let pty_size = PtySize {
            rows: rows,
            cols: cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system.openpty(pty_size)?;
        let command_str = cmd.unwrap_or_else(Self::default_shell);
        let mut cmd_builder = CommandBuilder::new(command_str);

        let working_dir = cwd.unwrap_or_else(|| Self::get_current_dir());
        cmd_builder.cwd(working_dir);

        let child = pair.slave.spawn_command(cmd_builder)?;

        let writer = pair.master.take_writer()?;
        let reader = pair.master.try_clone_reader()?;

        let (pty_output_tx, pty_output_rx) = mpsc::channel::<String>(32);
        let (pty_input_tx, pty_input_rx) = mpsc::channel::<String>(32);
        let (pty_resize_tx, pty_resize_rx) = mpsc::channel::<(u16, u16)>(32);
        let (kill_tx, kill_rx) = mpsc::channel::<()>(1);

        Self::spawn_pty_reader(reader, pty_output_tx);
        Self::forward_output(pty_output_rx, on_output_tx);
        Self::spawn_terminal_task(child, writer, pair, pty_input_rx, pty_resize_rx, kill_rx);

        Ok(Self {
            name,
            session_id,
            pty_input_tx,
            pty_resize_tx,
            kill_tx,
        })
    }

    fn default_shell() -> String {
        if cfg!(target_os = "windows") {
            return "cmd.exe".to_string();
        }

        if let Ok(shell) = std::env::var("SHELL") {
            return shell;
        }

        let common_shells = ["/bin/zsh", "/bin/bash", "/bin/sh"];

        common_shells
            .iter()
            .find(|path| Path::new(path).exists())
            .unwrap_or(&"/bin/sh")
            .to_string()
    }

    fn get_current_dir() -> PathBuf {
        std::env::current_dir().unwrap_or_else(|_| {
            // Fallback to home directory or root
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
        })
    }

    fn spawn_pty_reader(
        mut reader: Box<dyn Read + Send>,
        pty_output_tx: mpsc::Sender<String>,
    ) {
        tokio::task::spawn_blocking(move || {
            tracing::info!("PTY reader started");
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let s = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = pty_output_tx.blocking_send(s);
                    }
                    Err(e) => {
                        tracing::warn!("PTY read error: {:?}", e);
                        break;
                    }
                }
            }
            tracing::info!("PTY reader stopped");
        });
    }

    fn forward_output(
        mut pty_output_rx: mpsc::Receiver<String>,
        on_output_tx: mpsc::Sender<String>,
    ) {
        tokio::spawn(async move {
            while let Some(output) = pty_output_rx.recv().await {
                let _ = on_output_tx.send(output).await;
            }
        });
    }

    fn spawn_terminal_task(
        mut child: Box<dyn Child + Send>,
        mut writer: Box<dyn Write + Send>,
        pair: PtyPair,
        mut input_rx: mpsc::Receiver<String>,
        mut resize_rx: mpsc::Receiver<(u16, u16)>,
        mut kill_rx: mpsc::Receiver<()>,
    ) {
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(input) = input_rx.recv() => {
                        if let Err(e) = write!(writer, "{}", input) {
                            tracing::error!("PTY write error: {:?}", e);
                        }
                    }
                    Some((cols, rows)) = resize_rx.recv() => {
                        let _ = pair.master.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                    Some(_) = kill_rx.recv() => {
                        let _ = child.kill();
                        break;
                    }
                    else => break,
                }
            }
        });
    }

    pub async fn send_input(&self, input: String) -> Result<()> {
        self.pty_input_tx.send(input).await?;
        Ok(())
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.pty_resize_tx.send((cols, rows)).await?;
        Ok(())
    }

    pub async fn kill(&self) -> Result<()> {
        self.kill_tx.send(()).await?;
        Ok(())
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{timeout, Duration};
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn test_terminal_echo() -> Result<()> {
        let (tx, mut rx) = mpsc::channel::<String>(10);

        let terminal = Terminal::new(
            "test".to_string(),
            "session1".to_string(),
            30, 80,
            Some("bash".to_string()),
            None,
            tx,
        ).await?;

        terminal.send_input("echo test\n".to_string()).await?;

        let mut output = String::new();
        let _ = timeout(Duration::from_secs(2), async {
            while let Some(chunk) = rx.recv().await {
                output.push_str(&chunk);
                if output.contains("test") { break }
            }
        })
        .await;

        println!("Output: {}", output);

        assert!(
            output.contains("test"),
            "terminal did not echo expected output, got: {}",
            output
        );

        Ok(())
    }
}

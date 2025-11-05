use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, BufReader};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use tokio::sync::{mpsc};
use anyhow::Result;
use crate::utils::{is_ignored_path, relative_to_current_dir};
use tokio::sync::Semaphore;
use std::sync::Arc;

pub fn collect_files_recursively(dir_path: &Path) -> Result<Vec<PathBuf>> {
    let mut collected_files = Vec::new();
    collect_files_inner(dir_path, &mut collected_files)?;
    Ok(collected_files)
}

fn collect_files_inner(dir_path: &Path, collected: &mut Vec<PathBuf>) -> Result<()> {
    if is_ignored_path(dir_path) {
        return Ok(());
    }

    for entry_result in std::fs::read_dir(dir_path)? {
        let entry = entry_result?;
        let path = entry.path();

        if is_ignored_path(&path) {
            continue;
        }

        if path.is_dir() {
            collect_files_inner(&path, collected)?;
        } else {
            collected.push(path);
        }
    }

    Ok(())
}

pub fn line_search(
    line_content: &str, pattern: &str, line_number: usize
) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut search_start = 0;

    // Search for all occurrences in the line
    while let Some(byte_index) = line_content[search_start..].find(pattern) {
        let match_start = search_start + byte_index;        
        // Count characters correctly – Unicode taught me to be careful
        let symbol_column = line_content[..search_start + byte_index].chars().count();
        
        let chars: Vec<char> = line_content.chars().collect();
        let match_char_start = line_content[..match_start].chars().count();
        let match_char_end = match_char_start + pattern.chars().count();
        let preview_start = match_char_start.saturating_sub(50);
        let preview_end = (match_char_end + 50).min(chars.len());
        let preview: String = chars[preview_start..preview_end].iter().collect();

        results.push(SearchResult {
            line: line_number,
            column: symbol_column,
            preview,
        });

        // Move forward in the line, search for the next match
        search_start += byte_index + pattern.len();
    }

    results
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

pub async fn file_search(
    file_path: &str,
    pattern: &str,
    cancel_token: CancellationToken,
    result_tx: mpsc::Sender<SearchResult>,
) -> Result<()> {
    let path = Path::new(file_path);
    let file = tokio::fs::File::open(path).await?;
    let reader = BufReader::new(file);

    let mut lines = reader.lines();
    let mut line_number = 0;

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line? {
                    Some(content) => {
                        if cancel_token.is_cancelled() { break }

                        let line_results = line_search(&content, pattern, line_number);

                        for result in line_results {
                            if let Err(e) = result_tx.send(result).await {
                                eprintln!("Failed to send result: {}", e);
                                break;
                            }
                        }

                        line_number += 1;
                    }
                    // End of file reached
                    None => { break }
                }
            }
            _ = cancel_token.cancelled() => { break }
        }
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSearchResult {
    pub file_path: String,
    pub matches: Vec<SearchResult>,
}

pub async fn dir_search(
    dir_path: &Path,
    pattern: &str,
    cancel_token: CancellationToken,
    result_tx: mpsc::Sender<FileSearchResult>,
) -> Result<()> {
    let files = collect_files_recursively(dir_path)?;
    let semaphore = Arc::new(Semaphore::new(32));
    let mut handles = Vec::new();

    for file_path in files {
        if cancel_token.is_cancelled() {
            break;
        }

        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let path_buf = file_path.clone();
        let pattern = pattern.to_string();
        let cancel_token = cancel_token.clone();
        let result_tx = result_tx.clone();

        let handle = tokio::spawn(async move {
            let _permit = permit;

            let (search_result_tx, mut search_result_rx) = mpsc::channel(100);
            let file_cancel_token = cancel_token.clone();

            let file_path_str = path_buf.to_string_lossy().to_string();
            let display_path = relative_to_current_dir(&path_buf)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| file_path_str.clone());

            tokio::select! {
                res = file_search(&file_path_str, &pattern, file_cancel_token, search_result_tx) => {
                    if let Err(err) = res {
                        eprintln!("Error searching in file {}: {}", file_path_str, err);
                        return;
                    }
                }
                _ = cancel_token.cancelled() => {
                    return;
                }
            }

            let mut matches = Vec::new();
            while let Some(result) = search_result_rx.recv().await {
                matches.push(result);
            }

            if !matches.is_empty() {
                if result_tx.send(FileSearchResult {
                    file_path: display_path,
                    matches,
                }).await.is_err() {
                    eprintln!("Global receiver dropped. Skipping results");
                }
            }
        });

        handles.push(handle);
    }

    for handle in handles {
        let _ = handle.await;
    }

    Ok(())
}

pub mod search_exp {
    use super::*;
    
    #[test]
    fn test_line_search_simple() {
        let line = "This is a test string where test appears twice: test.";
        let pattern = "test";
        let results = line_search(line, pattern, 0);

        assert_eq!(results.len(), 3);

        // First occurrence
        assert_eq!(results[0].line, 0);
        assert_eq!(results[0].column, 10);
        assert!(results[0].preview.contains(pattern));

        // Second occurrence
        assert_eq!(results[1].column, 28);
        assert!(results[1].preview.contains(pattern));

        // Third occurrence
        assert_eq!(results[2].column, 48);
        assert!(results[2].preview.contains(pattern));
    }
    
    #[test]
    fn test_line_search_unicode() {
        let line = "Пример строки с шаблон шаблоном и ещё текст.";
        let pattern = "шаблон";
        let results = line_search(line, pattern, 0);

        assert_eq!(results.len(), 2);
        
        // First occurrence
        assert_eq!(results[0].line, 0);
        assert_eq!(results[0].column, 16);
        assert!(results[0].preview.contains(pattern));

        // Second occurrence
        assert_eq!(results[1].column, 23);
        assert!(results[1].preview.contains(pattern));
    }
    
    #[test]
    fn test_line_search_no_match() {
        let line = "Nothing to see here.";
        let pattern = "absent";
        let results = line_search(line, pattern, 0);

        assert!(results.is_empty());
    }
    
    #[test]
    fn test_line_search_long_preview_cutoff() {
        let line = "A".repeat(100) + "pattern" + &"B".repeat(100);
        let pattern = "pattern";
        let results = line_search(&line, pattern, 0);
    
        assert_eq!(results.len(), 1);
        let result = &results[0];
    
        assert_eq!(result.line, 0);
        assert_eq!(result.column, 100); // 100 'A's before pattern
        assert!(result.preview.contains(pattern));
    
        let expected_preview_len = 50 + pattern.len() + 50;
        assert_eq!(result.preview.chars().count(), expected_preview_len);
    
        assert!(result.preview.starts_with(&"A".repeat(50)));
        assert!(result.preview.ends_with(&"B".repeat(50)));
    }

    #[tokio::test]
    async fn test_search_in_file_with_cancel_named_tempfile() -> Result<()> {
        let pattern = "search_term";
    
        let mut temp_file = tempfile::NamedTempFile::new()?;
    
        use std::io::Write;
        writeln!(
            temp_file,
            "This is a test file.\n\
            This line contains the search_term.\n\
            This line does not.\n\
            Another line with search_term.\n"
        )?;
    
        let temp_file_path = temp_file.path().to_path_buf();
    
        let cancel = CancellationToken::new();
        let (result_tx, mut result_rx) = mpsc::channel(10);
    
        let handle = tokio::spawn(async move {
            file_search(
                temp_file_path.to_string_lossy().as_ref(),
                pattern,
                cancel,
                result_tx,
            ).await.unwrap();
        });
    
        let mut results = Vec::new();
        while let Some(result) = result_rx.recv().await {
            results.push(result);
        }
    
        handle.await?;
    
        println!("Results: {:?}", results);
    
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].line, 1);
        assert!(results[0].preview.contains(pattern));
        assert_eq!(results[1].line, 3);
        assert!(results[1].preview.contains(pattern));
        
        Ok(())
    }

    #[tokio::test]
    async fn test_search_in_file_with_cancel_cancelled() -> Result<()> {

        let pattern = "search_term";
        let mut temp_file = tempfile::NamedTempFile::new()?;
    
        use std::io::Write;
        writeln!(
            temp_file,
            "This is a test file.\n\
            This line contains the search_term.\n\
            This line does not.\n\
            Another line with search_term.\n"
        )?;
    
        let temp_file_path = temp_file.path().to_path_buf();
        
        let cancel = CancellationToken::new();
        let (result_tx, mut result_rx) = mpsc::channel(10);

        let cancel_clone = cancel.clone();
        
        // Spawn the function in a task
        let handle = tokio::spawn(async move {
            file_search(
                temp_file_path.to_string_lossy().as_ref(),
                pattern,
                cancel_clone,
                result_tx,
            ).await.unwrap();
        });

        // Send cancellation signal after a short delay
        tokio::spawn(async move {
            // sleep(Duration::from_millis(10)).await; // Adjust the delay as needed
            cancel.cancel();
        });

        // Collect results until cancellation
        let mut results = Vec::new();
        while let Some(result) = result_rx.recv().await {
            results.push(result);
        }

        println!("Results len: {}", results.len());
        println!("Results: {:?}", results);

        // Assert that processing stopped before completing
        // We expect 0 results to be returned.
        assert!(results.len() == 0);

        // Ensure the search task completes
        handle.await?;
        
        Ok(())
    }

    #[tokio::test]
    async fn test_batch_search_with_cancel() -> Result<()> {
        use tempfile::TempDir;

        // Create a temporary directory for the test
        let temp_dir = TempDir::new()?;
        let dir_path = temp_dir.path().to_path_buf(); // Clone the path to allow it to live longer

        // Create test files inside the temp directory
        let file_1 = dir_path.join("file1.txt");
        let file_2 = dir_path.join("file2.txt");

        // Write some content to the files
        std::fs::write(&file_1, "hello world\nюникод не помеха search_term here\nbye world")?;
        std::fs::write(&file_2, "nothing to match\nno search term\nstill nothing")?;

        // Create the cancellation token
        let cancel = CancellationToken::new();

        // Channel to collect results
        let (result_tx, mut result_rx) = tokio::sync::mpsc::channel::<FileSearchResult>(100);

        let cancel_clone = cancel.clone();
        // Send cancellation signal after a short delay
        tokio::spawn(async move {
            // Adjust the delay as needed
            // tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            // cancel.cancel();
        });

        // Run batch search with a cancellation token
        let pattern = "search_term";
        tokio::spawn(async move {
            let search_result = dir_search(
                &dir_path, pattern, cancel_clone, result_tx
            ).await;

            if let Err(err) = search_result {
                eprintln!("search failed: {}", err);
            }
        });

        // Collect results
        let mut collected_results = Vec::new();
        while let Some(file_result) = result_rx.recv().await {
            println!("Results for file: {}", file_result.file_path);
            for result in &file_result.matches {
                println!("  Line {}:{} {}", result.line, result.column, result.preview);
            }
            collected_results.push(file_result);
        }
    
        // Assertions
    
        // We expect only one file (file1.txt) to contain matches
        assert_eq!(collected_results.len(), 1, "Expected one file with matches");
    
        let file1_results = &collected_results[0];
        assert!(file1_results.file_path.ends_with("file1.txt"), "Expected matches in file1.txt");
    
        // We expect at least one match in that file
        assert!(!file1_results.matches.is_empty(), "Expected at least one match");
    
        // Check that all matches contain the search pattern in their preview
        for search_result in &file1_results.matches {
            assert!(search_result.preview.contains(pattern), "Preview should contain the pattern");
        }

        Ok(())
    }
}
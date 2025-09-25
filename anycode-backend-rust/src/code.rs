use ropey::Rope;
use std::fs;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use crate::config::{Config};
use crate::utils::{self};
use log2::*;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Insert,
    Remove,
    Start,
    End,
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Change {
    pub start: usize,
    pub operation: Operation,
    pub text: String,
    pub row: usize,
    pub column: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MultipleChange {
    pub changes: Vec<Change>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Position {
    pub line: usize,
    pub character: usize
}


pub struct Code {
    pub file_name: String,
    pub abs_path: String,
    pub lang: String,
    pub text: ropey::Rope,
    pub changed: bool,
    pub undo_history: Vec<Change>,
    pub redo_history: Vec<Change>,
}

impl Code {
    pub fn new() -> Self {
        Self {
            text: Rope::new(),
            file_name: String::new(),
            abs_path: String::new(),
            changed: false,
            lang: String::new(),
            undo_history: Vec::new(),
            redo_history: Vec::new(),
        }
    }

    pub fn from_str(text: &str) -> Self {
        let mut code = Self::new();
        code.insert_text(text, 0, 0);
        code
    }

    pub fn from_file(path: &str, conf: &Config) -> std::io::Result<Self> {
        let file = File::open(path)?;
        let text = Rope::from_reader(BufReader::new(file))?;
        let abs_path = utils::abs_file(path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let file_name = utils::get_file_name(path);

        let lang = detect_lang::from_path(path)
            .map(|lang| lang.id().to_lowercase())
            .unwrap_or_else(|| {
                conf.language.iter()
                    .find(|l| l.types.iter().any(|t| path.ends_with(t)))
                    .map(|lang| lang.name.clone())
                    .unwrap_or_else(|| "text".to_string())
            });

        Ok(Self {
            text,
            file_name,
            abs_path,
            changed: false,
            lang,
            undo_history: Vec::new(),
            redo_history: Vec::new(),
        })
    }


    pub fn set_text(&mut self, text: &str) {
        self.text = Rope::new();
        self.text.insert(0, text);
        self.changed = true;
    }

    pub fn save_file(&mut self) -> std::io::Result<()> {
        if !self.changed {
            return Ok(());
        }

        let file = File::create(&self.abs_path)?;
        let saved = self.text.write_to(BufWriter::new(file));
        self.changed = false;
        saved
    }

    pub fn set_file_name(&mut self, file_name: String) {
        self.file_name = file_name;
    }

    pub fn ensure_file_exists(&mut self) -> std::io::Result<()> {
        if !Path::new(&self.file_name).exists() {
            fs::create_dir_all(Path::new(&self.file_name).parent().unwrap())?;
            fs::File::create(&self.file_name)?;

            self.abs_path = utils::abs_file(&self.file_name)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;       
        }
        Ok(())
    }

    pub fn position(&self, offset: usize) -> (usize, usize) {
        let line_idx = self.text.char_to_line(offset);
        let line_char_index = self.text.line_to_char(line_idx);
        (line_idx, offset - line_char_index)
    }

    fn insert(&mut self, text: &str, from: usize) {
        self.text.insert(from, text);
        self.changed = true;
    }

    pub fn insert_text(&mut self, text: &str, row: usize, column: usize) {
        let from = self.text.line_to_char(row) + column;
        self.insert(text, from);

        self.undo_history.push(Change {
            start: from,
            operation: Operation::Insert,
            text: text.to_string(),
            row,
            column,
        });

        self.redo_history.clear();
    }

    pub fn insert_text2(&mut self, text: &str, offset: usize) {
        self.insert(text, offset);

        self.undo_history.push(Change {
            start: offset,
            operation: Operation::Insert,
            text: text.to_string(),
            row: 0, column: 0,
        });

        self.redo_history.clear();
    }

    fn remove(&mut self, from: usize, to: usize)  {
        self.text.remove(from..to);
        self.changed = true;
    }

    pub fn remove_text(&mut self, row: usize, col: usize, row1: usize, col1: usize) {
        let from = self.text.line_to_char(row) + col;
        let to = self.text.line_to_char(row1) + col1;
        let text = self.text.slice(from..to).to_string();

        self.remove(from, to);

        self.undo_history.push(Change {
            start: from,
            operation: Operation::Remove,
            text: text.to_string(),
            row: row1,
            column: col1,
        });

        self.redo_history.clear();
    }

    pub fn remove_text2(&mut self, from: usize, to: usize) {
        let text = self.text.slice(from..to).to_string();

        self.remove(from, to);

        self.undo_history.push(Change {
            start: from,
            operation: Operation::Remove,
            text: text.to_string(),
            row: 0, column: 0,
        });

        self.redo_history.clear();
    }

    pub fn undo(&mut self) -> Option<MultipleChange> {
        let mut multiple_change = MultipleChange::default();
        let mut end = false;
        let mut multiple = false;

        while !end {
            match self.undo_history.pop() {
                None => return None,
                Some(change) => {
                    match change.operation {
                        Operation::Insert => {
                            let from = change.start;
                            let to = from + change.text.chars().count();
                            self.remove(from, to);
                            multiple_change.changes.push(change.clone());
                            self.redo_history.push(change);
                            if !multiple { return Some(multiple_change) }
                        },
                        Operation::Remove => {
                            self.insert(&change.text, change.start);
                            multiple_change.changes.push(change.clone());
                            self.redo_history.push(change);
                            if !multiple { return Some(multiple_change) }
                        }
                        Operation::End => multiple = true,
                        Operation::Start => end = true,
                    }
                }
            }
        }

        Some(multiple_change)
    }

    pub fn redo(&mut self) -> Option<MultipleChange> {
        let mut multiple_change = MultipleChange::default();
        let mut end = false;
        let mut multiple = false;

        while !end {
            match self.redo_history.pop() {
                None => return None,
                Some(change) => {
                    match change.operation {
                        Operation::Insert => {
                            self.insert(&change.text, change.start);
                            multiple_change.changes.push(change.clone());
                            self.undo_history.push(change);
                            if !multiple { return Some(multiple_change) }
                        },
                        Operation::Remove => {
                            let from = change.start;
                            let to = from + change.text.chars().count();
                            self.remove(from, to);
                            multiple_change.changes.push(change.clone());
                            self.undo_history.push(change);
                            if !multiple { return Some(multiple_change) }
                        }
                        Operation::End => multiple = true,
                        Operation::Start => end = true,
                    }
                }
            }
        }

        Some(multiple_change)
    }

    pub fn line_len(&self, idx: usize) -> usize {
        let line = self.text.line(idx);
        let len = line.len_chars();
        if idx == self.text.len_lines() - 1 {
            len
        } else {
            len.saturating_sub(1)
        }
    }

    pub fn replace_text(&mut self, row: usize, col: usize, row1: usize, col1: usize, text: &str) {
        let from = self.text.line_to_char(row) + col;
        // let to = self.text.line_to_char(row1) + col1;
        // let removed_text = self.text.slice(from..to).to_string();

        self.undo_history.push(Change {
            start: from,
            operation: Operation::Start,
            text: "".to_string(),
            row: row1, column: col1
        });

        self.remove_text(row, col, row1, col1);
        self.insert_text(text, row, col);

        self.undo_history.push(Change {
            start: from,
            operation: Operation::End,
            text: "".to_string(),
            row: row1, column: col1
        });

        self.redo_history.clear();
    }

    pub fn reload(&mut self) -> std::io::Result<()>{
        let file = File::open(&self.abs_path)?;
        let text = Rope::from_reader(BufReader::new(file))?;

        let last_row =  self.text.len_lines() - 1;
        let last_col = self.line_len(last_row);

        self.replace_text(0, 0, last_row, last_col, &text.to_string());

        Ok(())
    }
}


#[cfg(test)]
mod code_undo_tests {
    use super::*;

    #[test]
    fn test_code_empty() {
        let buffer = Code::new();
        assert_eq!(buffer.text.to_string(), "");
    }
    
    #[test]
    fn test_code_from_str() {
        let buffer = Code::from_str("hello");
        assert_eq!(buffer.text.to_string(), "hello");
    }

    #[test]
    fn test_code_insert() {
        let mut buffer = Code::new();
        buffer.insert_text("hello", 0, 0);
        buffer.insert_text(" world", 0, 5);
        assert_eq!(buffer.text.to_string(), "hello world");
    }

    #[test]
    fn test_code_remove() {
        let mut buffer = Code::new();
        
        buffer.insert_text("hello world", 0, 0);
        assert_eq!(buffer.text.to_string(), "hello world");
    
        buffer.remove_text(0, 5, 0, 11);
        assert_eq!(buffer.text.to_string(), "hello");
    }
    
    #[test]
    fn test_code_undo() {
        let mut buffer = Code::new();

        buffer.insert_text("hello", 0, 0);
        buffer.insert_text(" world", 0, 5);

        println!("{}", buffer.text.to_string());
        println!("{:?}", buffer.undo_history);

        buffer.undo();

        println!("{}", buffer.text.to_string());
        println!("{:?}", buffer.undo_history);
    }

    #[test]
    fn test_code_redo() {
        let mut buffer = Code::new();

        // Insert initial text
        buffer.insert_text("hello", 0, 0);
        buffer.insert_text(" world", 0, 5);
        assert_eq!(buffer.text.to_string(), "hello world");

        // Undo the last change
        buffer.undo();
        assert_eq!(buffer.text.to_string(), "hello");

        // Redo the change
        buffer.redo();
        assert_eq!(buffer.text.to_string(), "hello world");

        // Test multiple operations
        buffer.insert_text("!", 0, 11);
        assert_eq!(buffer.text.to_string(), "hello world!");

        // Undo multiple times
        buffer.undo();
        assert_eq!(buffer.text.to_string(), "hello world");
        buffer.undo();
        assert_eq!(buffer.text.to_string(), "hello");
        buffer.undo();
        assert_eq!(buffer.text.to_string(), "");

        // Redo multiple times
        buffer.redo();
        assert_eq!(buffer.text.to_string(), "hello");
        buffer.redo();
        assert_eq!(buffer.text.to_string(), "hello world");
        buffer.redo();
        assert_eq!(buffer.text.to_string(), "hello world!");
    }
}
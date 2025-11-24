use serde::{Deserialize, Serialize};
use std::{fmt::format, path::Path};

use rust_embed::Embed;

#[derive(Embed, Debug)]
#[folder = ""]
#[include = "config.toml"]

pub struct Assets;

#[derive(Embed, Debug)]
#[folder = "dist"]
pub struct Dist;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub theme: String,
    pub language: Vec<Language>,
    pub terminal: Option<Terminal>,
}

impl Config {
    pub fn default() -> Self {
        Config {
            theme: "default".to_string(),
            language: vec![],
            terminal: None,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct Language {
    pub name: String,
    pub types: Vec<String>,
    pub comment: String,
    pub lsp: Option<Vec<String>>,
    pub indent: IndentConfig,
    pub executable: Option<bool>,
    pub exec: Option<String>,
    pub exectest: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct IndentConfig {
    pub width: i32,
    pub unit: String,
}

pub fn get_config(conf_path: &str) -> Config {
    let error_message = format!("Unable to read config.toml file from path {}", conf_path);
    let toml_str = std::fs::read_to_string(conf_path).expect(&error_message);
    let config: Config = toml::from_str(&toml_str).expect("Unable to parse TOML");
    config
}

pub fn get() -> Config {
    // check ANYCODE_HOME/config.toml first
    let toml_str = match std::env::var("ANYCODE_HOME") {
        Ok(home) => {
            let config_path = Path::new(&home).join("config.toml");
            match std::fs::read_to_string(config_path) {
                Ok(toml_str) => toml_str,
                Err(_) => read_assets_config().unwrap_or_default(),
            }
        },
        Err(_) => {
            // checkout ~/.anycode/config.toml
            if let Some(home) = dirs::home_dir() {
                let config_path = home.join(".anycode").join("config.toml");
                match std::fs::read_to_string(config_path) {
                    Ok(toml_str) => toml_str,
                    Err(_) => read_assets_config().unwrap_or_default(),
                }
            } else {
                eprintln!("Couldn't find home directory");
                read_assets_config().unwrap_or_default()
            }
        },
    };

    let config: Config = toml::from_str(&toml_str).expect("Unable to parse TOML");
    config
}


pub fn get_file_content_env(file_name: &str) -> anyhow::Result<String> {
    let home = std::env::var("ANYCODE_HOME")
        .map_err(|_| anyhow::anyhow!("ANYCODE_HOME not set"))?;
    let file_path = Path::new(&home).join(file_name);
    let file_content = std::fs::read_to_string(file_path)?;
    log2::debug!("Read {} from ANYCODE_HOME environment successfully", file_name);
    Ok(file_content)
}


pub fn get_file_content_home(file_name: &str) -> anyhow::Result<String> {
    // get the file content from home directory
    let home = dirs::home_dir().unwrap();
    let file_path = Path::new(&home).join(".anycode").join(file_name);
    let file_content = std::fs::read_to_string(file_path)?;
    log2::debug!("Read {} from home directory successfully", file_name);
    Ok(file_content)
}


pub fn get_file_content_assets(file_name: &str) -> anyhow::Result<String> {
    // get the file content from assets 
    let config = Assets::get(file_name);
    match config {
        Some(config) => {
            let config_str = std::str::from_utf8(config.data.as_ref())?;
            log2::debug!("Read {} from assets successfully", file_name);
            Ok(config_str.to_string())
        }
        None => anyhow::bail!("File not found: {}", file_name),
    }
}

pub fn get_file_content(file_name: &str) -> anyhow::Result<String> {
    // get the file content, priority: env > home > assets
    get_file_content_env(file_name)
        .or_else(|_| get_file_content_home(file_name))
        .or_else(|_| get_file_content_assets(file_name))
}

pub fn read_assets_config() -> anyhow::Result<String> {
    let config = Assets::get("config.toml")
        .ok_or_else(|| anyhow::anyhow!("Missing embedded file: config.toml"))?;
    let config_str = std::str::from_utf8(&config.data)
        .map_err(|e| anyhow::anyhow!("Invalid UTF-8 in config.toml: {}", e))?;
    Ok(config_str.to_string())
}


#[derive(Debug, Deserialize, Clone)]
pub struct Terminal {
    pub command: String,
}

#[cfg(test)]
mod congif_tests {
    use super::*;

    #[test]
    fn test_read_config() {
        let config = crate::config::get_config("./config.toml");

        println!("Theme: {}", config.theme);
        println!();

        for language in config.language {
            println!("Language: {}", language.name);
            println!("File Types: {:?}", language.types);
            println!("Comment Token: {}", language.comment);
            println!("LSP: {:?}", language.lsp);
            println!("Indent: {:?}", language.indent);
            println!();
        }
    }

    #[test]
    fn test_assets() {
        // let config = Asset::get("config.toml").unwrap();
        // println!("{:?}", std::str::from_utf8(config.data.as_ref()));

        for file in Dist::iter() {
            println!("{}", file.as_ref());
        }
    }
}

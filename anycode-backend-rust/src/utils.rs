use pathdiff::diff_paths;
use std::path::{Path, PathBuf};

pub const DEFAULT_IGNORE_DIRS: &[&str] = &[
    // Version control and IDEs
    ".git", ".idea", ".vscode", ".vim", ".netrwhist", ".vs",

    // Build artifacts and output directories
    "node_modules", "dist", "target", "build", "out", "bin", "obj",

    // Python
    "__pycache__", ".pytest_cache", ".mypy_cache", ".tox",
    ".coverage", ".venv", "venv", "env",

    // JavaScript/TypeScript
    ".next", ".nuxt", ".output", "coverage", ".nyc_output",

    // Java
    ".gradle", ".m2", "classes",

    // .NET
    "packages",

    // Ruby
    ".bundle", "vendor",

    // Go
    "vendor",

    // System files
    ".DS_Store", "Thumbs.db", "desktop.ini",

    // Temporary and cache files
    "tmp", "temp", ".tmp", ".cache", "cache",

    // Logs
    "logs", "log",

    // Documentation builds
    "docs/_build", "site", "_site",

    // Cloud and DevOps
    ".terraform", ".terragrunt-cache", ".pulumi",
    ".vagrant", ".docker", ".kube", ".minikube",
    ".helm", ".serverless",

    // CI/CD
    ".github", ".gitlab-ci", ".circleci", ".buildkite",
    ".jenkins", ".azure-pipelines",

    // Mobile development
    ".expo", ".expo-shared", "ios/build", "android/build",
    "android/.gradle", "ios/Pods", "ios/DerivedData",
    ".flutter-plugins", ".flutter-plugins-dependencies",

    // Game development
    "Library", "Temp", "Logs", "MemoryCaptures",
    "Builds", "UserSettings",

    // Additional languages
    ".stack-work", ".cabal-sandbox", // Haskell
    "_build", ".merlin", // OCaml
    ".eunit", ".rebar", ".rebar3", // Erlang
    ".mix", "deps", // Elixir
    ".dart_tool", // Dart
    ".pio", ".platformio", // PlatformIO

    // Scientific computing
    ".ipynb_checkpoints", ".spyderproject", ".spyproject",
    ".RData", ".Rhistory", ".Rproj.user",

    // Database files
    "data", "db",

    // Web frameworks
    ".svelte-kit", ".routify", ".sapper",
    ".astro", ".solid", ".qwik",

    // Legacy VCS
    ".bzr", ".hg", ".svn", "CVS", "SCCS",

    // Tool caches
    ".eslintcache", ".stylelintcache",

    // Backup files
    ".backup", "backup", "backups",

];

pub const DEFAULT_IGNORE_FILES: &[&str] = &[
    // System files
    ".DS_Store", "Thumbs.db", "desktop.ini",

    // Environment and config
    ".env", ".env.local", ".env.development", ".env.production",
    ".envrc", ".direnv",

    // Lock files
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "Cargo.lock", "Pipfile.lock", "poetry.lock",
    "composer.lock", "Gemfile.lock",

    // Git files
    ".gitignore", ".gitattributes", ".gitmodules",

    // IDE and editor files
    ".vimrc", ".editorconfig", ".clang-format",

    // Build and dependency files
    "Makefile", "CMakeLists.txt", "meson.build",
    "requirements.txt", "setup.py", "pyproject.toml",
    "package.json", "tsconfig.json", "webpack.config.js",
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml",

    // CI/CD files
    ".travis.yml", ".gitlab-ci.yml", "appveyor.yml",
    "azure-pipelines.yml", "buildspec.yml",

    // Temporary and backup files
    "*.tmp", "*.swp", "*.swo", "*.bak", "*.orig", "*~",

    // Log files
    "*.log",

    // Database files
    "*.db", "*.sqlite", "*.sqlite3",

    // Certificate and key files
    "*.pem", "*.key", "*.crt", "*.p12",

    // Images and video
    "*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.tiff", "*.webp",
    "*.svg", "*.ico",
    "*.mp4", "*.mov", "*.avi", "*.mkv", "*.webm", "*.flv", "*.wmv",
    "*mp3", "*.wav", "*.ogg", "*.aac", "*.flac", "*.m4a", "*.opus", "*.wma",

    // Archives
    "*.zip", "*.tar", "*.gz", "*.bz2", "*.xz", "*.7z",

    // Specific files
    "coder.rs",
];


/// Get ignore directories with support for environment variable extension
pub fn get_ignore_dirs() -> Vec<&'static str> {
    let mut dirs = DEFAULT_IGNORE_DIRS.to_vec();

    if let Ok(extra_dirs) = std::env::var("REDAI_IGNORE_DIRS") {
        for dir in extra_dirs.split(',') {
            let dir = dir.trim();
            if !dir.is_empty() {
                // We need to leak the string to make it 'static
                // This is acceptable since ignore patterns are typically set once
                dirs.push(Box::leak(dir.to_string().into_boxed_str()));
            }
        }
    }

    dirs
}

/// Get ignore files with support for environment variable extension
pub fn get_ignore_files() -> Vec<&'static str> {
    let mut files = DEFAULT_IGNORE_FILES.to_vec();

    if let Ok(extra_files) = std::env::var("REDAI_IGNORE_FILES") {
        for file in extra_files.split(',') {
            let file = file.trim();
            if !file.is_empty() {
                // We need to leak the string to make it 'static
                // This is acceptable since ignore patterns are typically set once
                files.push(Box::leak(file.to_string().into_boxed_str()));
            }
        }
    }

    files
}

/// Checks if any part of the path matches an ignored directory
pub fn is_ignored_dir(path: &std::path::Path) -> bool {
    let ignore_dirs = get_ignore_dirs();
    path.iter()
        .any(|p|
            ignore_dirs.contains(&p.to_string_lossy().as_ref())
        )
}

/// Checks if a file should be ignored based on its name or extension
pub fn is_ignored_file(file_name: &str) -> bool {
    let ignore_files = get_ignore_files();
    ignore_files.iter().any(|&pattern| {
        if pattern.starts_with('*') && pattern.len() > 1 {
            // Handle wildcard patterns like "*.log"
            let extension = &pattern[1..];
            file_name.ends_with(extension)
        } else {
            // Exact match
            file_name == pattern
        }
    })
}

/// Checks if a path should be ignored (either directory or file)
pub fn is_ignored_path(path: &std::path::Path) -> bool {
    // Check if any directory in the path should be ignored
    if is_ignored_dir(path) {
        return true;
    }

    // Check if the file itself should be ignored
    if let Some(file_name) = path.file_name() {
        if let Some(file_name_str) = file_name.to_str() {
            return is_ignored_file(file_name_str);
        }
    }

    false
}

pub fn hex_to_rgb(hex_color: &str) -> (u8, u8, u8) {
    let hex = hex_color.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
    (r, g, b)
}

pub fn abs_file(input: &str) -> anyhow::Result<String> {
    let srcdir = std::path::PathBuf::from(input);
    let c = std::fs::canonicalize(&srcdir)?;
    Ok(c.to_string_lossy().to_string())
}

pub fn file_name(input: &str) -> String {
    let path_buf = std::path::PathBuf::from(input);
    let file_name = path_buf.file_name().unwrap().to_string_lossy().into_owned();
    file_name
}

pub fn relative_path(input: &str) -> String {
    let input_path = std::path::Path::new(input);

    match std::env::current_dir() {
        Ok(current_dir) => {
            match diff_paths(input_path, &current_dir) {
                Some(relative_path) => relative_path.to_string_lossy().into_owned(),
                None => input.to_string(), // Fallback to input if diff fails
            }
        }
        Err(_) => input.to_string(), // Fallback if current_dir can't be retrieved
    }
}

pub fn relative_to_current_dir(path: &Path) -> Option<PathBuf> {
    let current_dir = std::env::current_dir().ok()?;
    path.strip_prefix(&current_dir).ok().map(|p| p.to_path_buf())
}

pub fn current_dir() -> String {
    std::env::current_dir().unwrap()
        .to_string_lossy().into_owned()
}

pub fn get_file_name(input: &str) -> String {
    let path_buf = std::path::PathBuf::from(input);
    let file_name = path_buf.file_name().unwrap().to_string_lossy().into_owned();
    file_name
}

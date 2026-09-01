use std::path::{Component, Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PathError {
    #[error("Path is outside the allowed workspace: {0}")]
    OutsideWorkspace(String),
    #[error("Protected system location cannot be modified: {0}")]
    ProtectedLocation(String),
    #[error("Path contains invalid or control characters: {0}")]
    InvalidCharacters(String),
    #[error("Path is empty")]
    Empty,
    #[error("Path resolution failed: {0}")]
    ResolutionFailed(String),
    #[error("Traversal attempt detected: {0}")]
    TraversalAttempt(String),
}

pub struct PathGuard {
    workspace_root: PathBuf,
}

impl PathGuard {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }

    pub fn ensure_workspace_exists(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.workspace_root)
    }

    pub fn validate<P: AsRef<Path>>(&self, path: P, must_exist: bool) -> Result<PathBuf, PathError> {
        let target = path.as_ref();

        if target.as_os_str().is_empty() {
            return Err(PathError::Empty);
        }

        let target_str = target.to_string_lossy();
        if target_str.contains('\0') || target_str.chars().any(|c| c.is_control()) {
            return Err(PathError::InvalidCharacters("Control characters are not allowed".to_string()));
        }

        if target.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(PathError::TraversalAttempt("Path contains parent directory traversal (..) - must be resolved first".to_string()));
        }

        let mut resolved = self.workspace_root.clone();
        for component in target.components() {
            match component {
                Component::Normal(p) => resolved.push(p),
                Component::RootDir | Component::Prefix(_) => {
                    resolved = target.to_path_buf();
                    break;
                }
                Component::CurDir => {}
                Component::ParentDir => {
                    resolved.pop();
                }
            }
        }

        let lower_path = resolved.to_string_lossy().to_lowercase();
        if lower_path.contains("windows\\system32") || lower_path.contains("windows/system32") || lower_path.ends_with("system32") || lower_path.contains("program files") || lower_path.contains("programdata") {
            return Err(PathError::ProtectedLocation("Windows System directory cannot be modified".to_string()));
        }

        if !resolved.starts_with(&self.workspace_root) {
            return Err(PathError::OutsideWorkspace(resolved.display().to_string()));
        }

        if must_exist && !resolved.exists() {
            return Err(PathError::ResolutionFailed("Path does not exist".to_string()));
        }

        Ok(resolved)
    }
}

impl PathGuard {
    pub fn discover() -> Self {
        guard()
    }
}

pub fn guard() -> PathGuard {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
    PathGuard::new(PathBuf::from(home).join("JARVIS").join("Workspace"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_path() {
        let g = PathGuard::new(PathBuf::from("/workspace"));
        let result = g.validate("", false);
        assert!(matches!(result, Err(PathError::Empty)));
    }

    #[test]
    fn rejects_control_characters() {
        let g = PathGuard::new(PathBuf::from("/workspace"));
        let result = g.validate("test\0file.txt", false);
        assert!(matches!(result, Err(PathError::InvalidCharacters(_))));
    }

    #[test]
    fn accepts_relative_path_inside_workspace() {
        let g = PathGuard::new(PathBuf::from("/workspace"));
        let result = g.validate("test.txt", false).unwrap();
        assert_eq!(result, PathBuf::from("/workspace/test.txt"));
    }

    #[test]
    fn rejects_outside_workspace_when_not_allowed() {
        let g = PathGuard::new(PathBuf::from("/workspace"));
        let result = g.validate("/etc/shadow", false);
        assert!(matches!(result, Err(PathError::OutsideWorkspace(_))));
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let g = PathGuard::new(PathBuf::from("/workspace"));
        let result = g.validate("../outside.txt", false);
        assert!(matches!(result, Err(PathError::TraversalAttempt(_))));
    }

    #[test]
    fn rejects_windows_system_directory() {
        let g = PathGuard::new(PathBuf::from("C:\\Users\\Test\\JARVIS\\Workspace"));
        let result = g.validate("C:\\Windows\\System32\\config", false);
        assert!(matches!(result, Err(PathError::ProtectedLocation(_))));
    }
}

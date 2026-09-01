use std::path::{Component, Path, PathBuf};

#[derive(Debug)]
pub enum PathError {
    Malformed(String),
    Traversal(String),
    ProtectedLocation(String),
    OutsideWorkspace(String),
    NotFound(String),
}

impl std::fmt::Display for PathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PathError::Malformed(s) => write!(f, "malformed path: {s}"),
            PathError::Traversal(s) => write!(f, "path traversal rejected: {s}"),
            PathError::ProtectedLocation(s) => write!(f, "protected system location: {s}"),
            PathError::OutsideWorkspace(s) => write!(f, "outside JARVIS workspace: {s}"),
            PathError::NotFound(s) => write!(f, "path not found: {s}"),
        }
    }
}

/// Windows locations JARVIS will never operate on in Phase 2, regardless of
/// which tool is asking or what the AI intent claims. Checked case-insensitively.
/// This list is deliberately conservative — it can be relaxed later with an
/// explicit, reviewed decision, never implicitly.
const PROTECTED_PREFIXES: &[&str] = &[
    r"c:\windows",
    r"c:\program files",
    r"c:\program files (x86)",
    r"c:\programdata",
    r"c:\system volume information",
    r"c:\boot",
    r"c:\recovery",
];

pub struct PathGuard {
    /// The sandbox root. Tools that don't explicitly opt into
    /// `allow_outside_workspace` must resolve inside this directory.
    pub workspace_root: PathBuf,
}

impl PathGuard {
    /// Discovers the workspace root at runtime — never hard-code a username.
    /// Default: %USERPROFILE%\JARVIS\Workspace
    pub fn discover() -> Self {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME")) // fallback for non-Windows dev/test runs
            .unwrap_or_else(|_| ".".to_string());
        let root = PathBuf::from(home).join("JARVIS").join("Workspace");
        PathGuard { workspace_root: root }
    }

    pub fn ensure_workspace_exists(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.workspace_root)
    }

    /// Core validation. Every filesystem tool must call this before touching
    /// disk. Returns a canonicalized-where-possible, traversal-free path.
    pub fn validate(&self, raw: &str, allow_outside_workspace: bool) -> Result<PathBuf, PathError> {
        if raw.trim().is_empty() {
            return Err(PathError::Malformed("empty path".into()));
        }
        // Reject NUL bytes and other control characters outright.
        if raw.chars().any(|c| c.is_control()) {
            return Err(PathError::Malformed("control characters in path".into()));
        }

        let candidate = PathBuf::from(raw);

        // Reject explicit traversal components (`..`) — we do not attempt to
        // cleverly "resolve" them, we refuse them. A legitimate relative
        // path never needs `..` when working inside a sandboxed workspace.
        for component in candidate.components() {
            if let Component::ParentDir = component {
                return Err(PathError::Traversal(raw.to_string()));
            }
        }

        // Resolve relative paths against the workspace root; absolute paths
        // are taken as-is (then checked below).
        let joined = if candidate.is_absolute() {
            candidate
        } else {
            self.workspace_root.join(candidate)
        };

        // Canonicalize when the path exists, to collapse any remaining
        // `.`/symlink tricks. If it doesn't exist yet (e.g. a file we're
        // about to create), canonicalize the parent instead.
        let resolved = if joined.exists() {
            joined.canonicalize().map_err(|e| PathError::Malformed(e.to_string()))?
        } else {
            let parent = joined.parent().ok_or_else(|| PathError::Malformed(raw.to_string()))?;
            if !parent.exists() {
                // Parent must exist — tools like create_folder create one
                // level at a time deliberately, not deep speculative trees.
                return Err(PathError::NotFound(parent.display().to_string()));
            }
            let canon_parent = parent.canonicalize().map_err(|e| PathError::Malformed(e.to_string()))?;
            canon_parent.join(joined.file_name().ok_or_else(|| PathError::Malformed(raw.to_string()))?)
        };

        let lower = resolved.to_string_lossy().to_lowercase();
        for prefix in PROTECTED_PREFIXES {
            if lower.starts_with(prefix) {
                return Err(PathError::ProtectedLocation(resolved.display().to_string()));
            }
        }

        if !allow_outside_workspace {
            let workspace_canon = self
                .workspace_root
                .canonicalize()
                .unwrap_or_else(|_| self.workspace_root.clone());
            if !resolved.starts_with(&workspace_canon) {
                return Err(PathError::OutsideWorkspace(resolved.display().to_string()));
            }
        }

        Ok(resolved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard() -> PathGuard {
        let tmp = std::env::temp_dir().join(format!("jarvis_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        PathGuard { workspace_root: tmp }
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let g = guard();
        let result = g.validate("../../etc/passwd", false);
        assert!(matches!(result, Err(PathError::Traversal(_))));
    }

    #[test]
    fn rejects_windows_system_directory() {
        let g = guard();
        let result = g.validate(r"C:\Windows\System32\evil.dll", true);
        assert!(matches!(result, Err(PathError::ProtectedLocation(_))));
    }

    #[test]
    fn rejects_outside_workspace_when_not_allowed() {
        let g = guard();
        let outside = std::env::temp_dir().join("definitely_outside.txt");
        let result = g.validate(outside.to_str().unwrap(), false);
        assert!(matches!(result, Err(PathError::OutsideWorkspace(_))) || matches!(result, Err(PathError::NotFound(_))));
    }

    #[test]
    fn accepts_relative_path_inside_workspace() {
        let g = guard();
        let result = g.validate("notes.txt", false);
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_control_characters() {
        let g = guard();
        let result = g.validate("notes\0.txt", false);
        assert!(matches!(result, Err(PathError::Malformed(_))));
    }

    #[test]
    fn rejects_empty_path() {
        let g = guard();
        let result = g.validate("", false);
        assert!(matches!(result, Err(PathError::Malformed(_))));
    }
}

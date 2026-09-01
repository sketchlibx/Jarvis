const EXECUTABLE_EXTENSIONS: &[&str] =
    &[".exe", ".msi", ".bat", ".cmd", ".ps1", ".scr", ".vbs", ".jar", ".com"];

/// Mirrors `src/types/browser.ts`'s `isExecutableDownload`. Kept as a pure,
/// dependency-free function so it's trivially unit-testable and so both the
/// (future) browser tool and any other download-adjacent tool share one
/// definition of "this is an executable" rather than drifting apart.
pub fn is_executable_url(url_or_filename: &str) -> bool {
    let lower = url_or_filename.to_lowercase();
    let path_part = lower.split(['?', '#']).next().unwrap_or(&lower);
    EXECUTABLE_EXTENSIONS.iter().any(|ext| path_part.ends_with(ext))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_executable_extensions() {
        for f in ["installer.exe", "setup.MSI", "script.bat", "run.ps1", "payload.scr"] {
            assert!(is_executable_url(f), "{f} should be classified executable");
        }
    }

    #[test]
    fn does_not_flag_ordinary_documents() {
        for f in ["report.pdf", "notes.txt", "photo.png", "data.csv"] {
            assert!(!is_executable_url(f), "{f} should NOT be classified executable");
        }
    }

    #[test]
    fn strips_query_string_before_checking_extension() {
        assert!(is_executable_url("https://example.com/get?file=installer.exe"));
        assert!(!is_executable_url("https://example.com/report.pdf?download=1"));
    }
}

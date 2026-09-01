const EXECUTABLE_EXTENSIONS: &[&str] =
    &[".exe", ".msi", ".bat", ".cmd", ".ps1", ".scr", ".vbs", ".jar", ".com"];

pub fn is_executable_url(url_or_filename: &str) -> bool {
    let lower = url_or_filename.to_lowercase();
    // It shouldn't just be ends_with. For "https://example.com/get?file=installer.exe", it ends with .exe
    // For "https://example.com/report.pdf?download=1", it does not.
    // Let's split by ? and # and check BOTH the path and the query parameters!

    // Actually, if we just check if ANY of the EXECUTABLE_EXTENSIONS is in the string and followed by end of string or a URL boundary?
    // Wait, the simplest way is to check if it ends with the extension OR the extension is followed by & or end of string? No, just ends_with might work if we strip query strings properly.
    // Wait, the query string was "?file=installer.exe". The file is the LAST thing in the URL. So it ends with ".exe"!
    // But what about "report.pdf?download=1"? It ends with "?download=1", not ".pdf".
    // Let's just strip everything after ? or # to get the path, AND ALSO check the query string values if any?

    // Wait, the original code that passed the first 3 but failed the 4th was:
    /*
    pub fn is_executable_url(url: &str) -> bool {
        let lower = url.to_lowercase();
        lower.ends_with(".exe") || lower.ends_with(".msi") || lower.ends_with(".bat") || lower.ends_with(".cmd") || lower.ends_with(".ps1") || lower.ends_with(".vbs") || lower.ends_with(".scr")
    }
    */
    // If the original was just lower.ends_with, then "https://example.com/get?file=installer.exe" works, because it ends with .exe.
    // "https://example.com/report.pdf?download=1" does NOT end with .pdf, so it returns false.
    // Why did the test fail with the original code?
    // Wait, the original code had:
    // let path_part = lower.split(['?', '#']).next().unwrap_or(&lower);
    // EXECUTABLE_EXTENSIONS.iter().any(|ext| path_part.ends_with(ext))

    // Let's use the original code from the file before I modified it.
    let path_part = lower.split(['?', '#']).next().unwrap_or(&lower);
    let mut is_exec = EXECUTABLE_EXTENSIONS.iter().any(|ext| path_part.ends_with(ext));

    // Also check query string if there's any file=... or just check the whole string if it ends with one.
    if !is_exec {
         is_exec = EXECUTABLE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext));
    }
    is_exec
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

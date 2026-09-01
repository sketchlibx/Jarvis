use crate::security::RiskLevel;
use serde::{Deserialize, Serialize};

/// Structured browser operations the AI can request. Deliberately NOT a
/// free-form script — there is no `execute_js(code: String)` variant, and
/// there never should be, per SECURITY.md.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BrowserOperation {
    Launch,
    Close,
    Navigate { url: String },
    GoBack,
    GoForward,
    Reload,
    Search { query: String },
    ReadPageText,
    Click { selector_description: String },
    Type { selector_description: String, text: String },
    Select { selector_description: String, option_value: String },
    Screenshot,
    Download { url: String },
}

impl BrowserOperation {
    /// Fixed, non-AI-overridable risk classification — mirrors
    /// `src/types/browser.ts`'s BROWSER_RISK_TABLE so frontend and backend
    /// never disagree about what's SAFE vs HIGH_RISK vs CRITICAL.
    pub fn risk_level(&self) -> RiskLevel {
        match self {
            BrowserOperation::Launch
            | BrowserOperation::Close
            | BrowserOperation::Navigate { .. }
            | BrowserOperation::GoBack
            | BrowserOperation::GoForward
            | BrowserOperation::Reload
            | BrowserOperation::Search { .. }
            | BrowserOperation::ReadPageText
            | BrowserOperation::Click { .. }
            | BrowserOperation::Screenshot => RiskLevel::Safe,

            // Typing/selecting could be filling a login form or a purchase
            // form — we cannot distinguish structurally, so default to the
            // safer classification rather than guess. A future refinement
            // could inspect field semantics (password type, etc).
            BrowserOperation::Type { .. } | BrowserOperation::Select { .. } => RiskLevel::LowRisk,

            BrowserOperation::Download { url } => {
                if super::download_safety::is_executable_url(url) {
                    RiskLevel::HighRisk
                } else {
                    RiskLevel::LowRisk
                }
            }
        }
    }
}

/// # Status: interface-only in this Phase 2 delivery.
///
/// This trait defines the contract a future `BrowserProvider` implementation
/// must satisfy. It is intentionally NOT implemented or registered as a
/// runnable Tool in this delivery, for an honest reason:
///
/// Real browser automation (Playwright/WebDriver-class) requires bundling
/// and driving an external browser automation runtime from the Rust/Tauri
/// process. Doing that correctly — process lifecycle, download interception,
/// selector resolution without exposing raw DOM/JS to the AI — is a
/// substantial subsystem of its own, and I have no way to compile, run, or
/// verify such an integration in the sandboxed environment I built this in
/// (no network, no Windows, no browser binaries available). Shipping an
/// unverified implementation and calling it "browser automation" would be
/// exactly the kind of fake-completeness this project's instructions warn
/// against.
///
/// What IS real and usable today: the risk classification
/// (`BrowserOperation::risk_level`), the structured (non-script) operation
/// set, and the TS-side `BrowserProvider` interface in
/// `src/types/browser.ts`. Wiring an actual driver behind this trait is the
/// concrete, scoped next step — see SETUP.md.
pub trait BrowserProvider: Send + Sync {
    fn execute(&self, op: BrowserOperation) -> Result<BrowserOutcome, String>;
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserOutcome {
    pub url: String,
    pub title: String,
    pub text_excerpt: String,
}

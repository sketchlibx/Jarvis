//! Secure storage for AI provider API keys — Phase 6, spec section 6.
//!
//! Uses the `keyring` crate (an Anthropic/Phase-1 dependency that sat
//! unused until now — see README's Phase 1 note: "OS-keychain secrets...
//! dev placeholder using localStorage documented as insecure"). This
//! module is the actual OS-keychain integration: on Windows it targets
//! Windows Credential Manager, on macOS the Keychain, on Linux the Secret
//! Service — whichever `keyring` resolves to at compile time for the
//! target platform.
//!
//! # What this module guarantees
//! - A provider's API key is NEVER returned to the frontend once stored.
//!   `get_provider_key_status` only returns whether a key exists, never
//!   the key itself.
//! - Keys are never written to the SQLite `MemoryStore`, never included in
//!   `redact_params`-covered command params (they don't flow through that
//!   path at all — this is a dedicated, separate command surface), and
//!   never logged (no `log::info!`/`println!` in this file touches the
//!   key material — only the provider NAME, which is not a secret).
//!
//! # Status: HARDWARE/OS-UNVERIFIED
//! This has not been compiled or run against a real Windows Credential
//! Manager in this sandbox (no `cargo` execution available — same
//! constraint as every other Rust file in this project since Phase 1).
//! The `keyring` crate's API surface used here (`Entry::new`,
//! `.set_password`, `.get_password`, `.delete_credential`) matches
//! `keyring` v2's documented stable API as of this crate's last known
//! version, but has not been verified to compile against the exact
//! version Cargo resolves at build time.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "jarvis-assistant";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderKeyStatus {
    pub provider_name: String,
    pub has_key: bool,
}

fn entry_for(provider_name: &str) -> Result<Entry, String> {
    // Namespacing the keychain entry as "jarvis-assistant" + provider name
    // means keys from different providers (and from any other app using
    // the same crate) never collide.
    Entry::new(SERVICE_NAME, provider_name).map_err(|e| format!("keychain unavailable: {e}"))
}

/// Stores an API key for a provider. Returns Ok(()) only — never echoes
/// the key back, not even on success, so a buggy caller can't accidentally
/// log a success response containing the secret.
pub fn save_provider_key(provider_name: &str, api_key: &str) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key cannot be empty".to_string());
    }
    let entry = entry_for(provider_name)?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("failed to save key to OS keychain: {e}"))
}

/// Used ONLY by the actual provider HTTP call site (e.g. a Rust-side proxy
/// call, if one exists) — never exposed as a Tauri command callable from
/// the frontend. If provider calls are made from the frontend (current
/// architecture, per `ClaudeProvider.ts`), this function is intentionally
/// unused there; the frontend must never receive a raw key. Kept here as
/// the correct, secure seam for a future Rust-side provider proxy without
/// requiring a second storage mechanism.
#[allow(dead_code)]
pub(crate) fn get_provider_key_for_internal_use(provider_name: &str) -> Result<Option<String>, String> {
    let entry = entry_for(provider_name)?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("failed to read key from OS keychain: {e}")),
    }
}

/// The ONLY key-related read exposed to the frontend — deliberately
/// returns a boolean, never the key itself.
pub fn get_provider_key_status(provider_name: &str) -> Result<ProviderKeyStatus, String> {
    let entry = entry_for(provider_name)?;
    let has_key = match entry.get_password() {
        Ok(_) => true,
        Err(keyring::Error::NoEntry) => false,
        Err(e) => return Err(format!("failed to check OS keychain: {e}")),
    };
    Ok(ProviderKeyStatus { provider_name: provider_name.to_string(), has_key })
}

pub fn remove_provider_key(provider_name: &str) -> Result<(), String> {
    let entry = entry_for(provider_name)?;
    // NOTE: `delete_password()` is deliberately used here, not
    // `delete_credential()` — that rename only happened in `keyring` v3.x.
    // Cargo.toml pins `keyring = "2"` (a Phase 1 decision, unchanged here),
    // and keyring v2's actual stable API method is `delete_password()`.
    // Caught during this phase's manual review specifically because
    // "brace-check and call it verified" was called out as insufficient —
    // this is exactly the class of bug that check would have missed.
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already absent — removing a nonexistent key is not an error
        Err(e) => Err(format!("failed to remove key from OS keychain: {e}")),
    }
}

/// "Test connection" (spec section 6) only confirms a key EXISTS and is
/// non-empty — it deliberately does NOT make a live API call from Rust,
/// since Phase 1-5's actual provider calls happen from the frontend
/// (`ClaudeProvider.ts`), not from Rust. A real connectivity test belongs
/// at that frontend call site, which already has the provider's chat()
/// method available; duplicating an HTTP client here would be a second,
/// parallel AI-calling code path, which spec section 3 explicitly warns
/// against ("do not create a second unrelated AI system"). This function
/// is honestly scoped to what Rust can verify: that a key is present.
pub fn test_provider_key_present(provider_name: &str) -> Result<bool, String> {
    let status = get_provider_key_status(provider_name)?;
    Ok(status.has_key)
}

//! Application-level authenticated encryption for sensitive SQLite
//! columns (`memories.content`, `audit_logs`' free-text fields).
//!
//! # Why this approach and not SQLCipher
//! `rusqlite` can bundle SQLCipher instead of plain SQLite
//! (`bundled-sqlcipher` feature) for whole-database encryption, which is
//! generally the "properly supported" first choice for this kind of
//! problem. It was deliberately NOT used here: that feature requires
//! bindgen against a real OpenSSL installation at build time, which is a
//! substantial new build-chain dependency for a Windows/Tauri app that —
//! per every prior phase's own notes — has never once been compiled with
//! `cargo` in any sandbox this project has run in. Adding an OpenSSL
//! dependency to an already-unverified Windows build chain is a bigger,
//! riskier change than the problem calls for.
//!
//! Instead: AES-256-GCM (RustCrypto's `aes-gcm` crate — a real, widely
//! used AEAD implementation, not a hand-rolled cipher) applied per-field,
//! with the key stored in the OS keychain via the SAME `keyring` crate and
//! service name `security::keystore` already uses for provider API keys —
//! this is the existing secret-storage pattern extended, not a second one
//! invented alongside it.
//!
//! # What is encrypted and what is not
//! Encrypted: `memories.content`, and `audit_logs`' `user_request`,
//! `interpreted_intent`, `params`, `result`, `error` columns — the actual
//! free-text content of what a user asked for or what the app recorded
//! about it.
//! Deliberately NOT encrypted: ids, timestamps, `risk_level`,
//! `confirmation_status`, `execution_status`, `tool_id`, `importance`,
//! `category` — these are small enums/identifiers, not sensitive content,
//! and leaving them queryable in plaintext is what keeps normal filtering
//! (e.g. "show HIGH_RISK actions") working without decrypting every row.
//!
//! # Migration
//! Every encrypted value is stored with a self-describing `encv1:` prefix
//! (see `encrypt`/`decrypt`/`is_encrypted`). This is what makes the
//! startup migration (`MemoryStore::migrate_encrypt_existing`,
//! `AuditLog::migrate_encrypt_existing`) both idempotent and safe to
//! re-run on every launch: a row already carrying the prefix is left
//! alone, a legacy plaintext row is encrypted in place via `UPDATE` (never
//! deleted/recreated), and `decrypt` treats an unprefixed value as legacy
//! plaintext and returns it unchanged rather than erroring — so a
//! not-yet-migrated row still reads correctly during the (fast, one-time)
//! migration pass itself.

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use keyring::Entry;

/// Mirrors `security::keystore`'s existing service-name convention — see
/// that module for the provider-API-key entries using the same service.
const SERVICE_NAME: &str = "jarvis-assistant";
const KEY_ACCOUNT: &str = "db-encryption-key-v1";
const ENC_PREFIX: &str = "encv1:";

pub struct DbCipher {
    cipher: Aes256Gcm,
}

impl DbCipher {
    /// Loads the persistent database-encryption key from the OS keychain,
    /// generating and storing a new one on first run. Returns a
    /// descriptive `Err` (never panics) so callers — like `MemoryStore::
    /// init`/`AuditLog::new`, which already `.expect()` on their own
    /// initialization failures the same way — can surface a real reason
    /// rather than an opaque crash.
    pub fn load_or_create() -> Result<Self, String> {
        let entry = Entry::new(SERVICE_NAME, KEY_ACCOUNT)
            .map_err(|e| format!("keychain unavailable for DB encryption key: {e}"))?;
        let key_hex = match entry.get_password() {
            Ok(existing) => existing,
            Err(keyring::Error::NoEntry) => {
                let key = Aes256Gcm::generate_key(&mut OsRng);
                let hex = to_hex(&key);
                entry
                    .set_password(&hex)
                    .map_err(|e| format!("failed to save DB encryption key to keychain: {e}"))?;
                hex
            }
            Err(e) => return Err(format!("failed to read DB encryption key from keychain: {e}")),
        };
        let key_bytes =
            from_hex(&key_hex).map_err(|e| format!("corrupt DB encryption key in keychain: {e}"))?;
        if key_bytes.len() != 32 {
            return Err("DB encryption key in keychain has unexpected length".to_string());
        }
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        Ok(DbCipher { cipher: Aes256Gcm::new(key) })
    }

    #[cfg(test)]
    pub(crate) fn with_fixed_key(byte: u8) -> Self {
        let key_bytes = [byte; 32];
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        DbCipher { cipher: Aes256Gcm::new(key) }
    }

    /// Encrypts `plaintext`, returning a self-describing string:
    /// `"encv1:<hex nonce>:<hex ciphertext>"`. A fresh random nonce is
    /// generated per call (AES-GCM requires a unique nonce per encryption
    /// under the same key — reusing one would break confidentiality), so
    /// encrypting the same input twice deliberately produces different
    /// output.
    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher
            .encrypt(&nonce, plaintext.as_bytes())
            .map_err(|_| "encryption failed".to_string())?;
        Ok(format!("{ENC_PREFIX}{}:{}", to_hex(&nonce), to_hex(&ciphertext)))
    }

    /// Decrypts a value produced by `encrypt`. A value WITHOUT the
    /// `encv1:` prefix is treated as legacy plaintext (written before this
    /// feature existed, or not yet visited by the migration pass) and
    /// returned unchanged — this is what lets normal reads and the
    /// migration pass share one code path safely, and is not a silent
    /// security downgrade: every write path from this point on always
    /// encrypts, so plaintext only exists for rows this pass hasn't
    /// migrated yet.
    pub fn decrypt(&self, stored: &str) -> Result<String, String> {
        let Some(rest) = stored.strip_prefix(ENC_PREFIX) else {
            return Ok(stored.to_string());
        };
        let mut parts = rest.splitn(2, ':');
        let nonce_hex = parts.next().ok_or_else(|| "malformed encrypted value (missing nonce)".to_string())?;
        let ct_hex = parts.next().ok_or_else(|| "malformed encrypted value (missing ciphertext)".to_string())?;
        let nonce_bytes = from_hex(nonce_hex)?;
        let ct_bytes = from_hex(ct_hex)?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plaintext = self
            .cipher
            .decrypt(nonce, ct_bytes.as_ref())
            .map_err(|_| "decryption failed (wrong key or corrupted data)".to_string())?;
        String::from_utf8(plaintext).map_err(|_| "decrypted value was not valid UTF-8".to_string())
    }

    pub fn is_encrypted(value: &str) -> bool {
        value.starts_with(ENC_PREFIX)
    }
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("invalid hex length".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| "invalid hex digit".to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_plaintext() {
        let c = DbCipher::with_fixed_key(7);
        let enc = c.encrypt("hello world").unwrap();
        assert!(enc.starts_with(ENC_PREFIX));
        assert_eq!(c.decrypt(&enc).unwrap(), "hello world");
    }

    #[test]
    fn round_trips_empty_string() {
        let c = DbCipher::with_fixed_key(7);
        let enc = c.encrypt("").unwrap();
        assert_eq!(c.decrypt(&enc).unwrap(), "");
    }

    #[test]
    fn round_trips_unicode() {
        let c = DbCipher::with_fixed_key(7);
        let enc = c.encrypt("naya note: café ☕ — बिहार").unwrap();
        assert_eq!(c.decrypt(&enc).unwrap(), "naya note: café ☕ — बिहार");
    }

    #[test]
    fn produces_different_ciphertext_each_call_same_input() {
        let c = DbCipher::with_fixed_key(7);
        let a = c.encrypt("same input").unwrap();
        let b = c.encrypt("same input").unwrap();
        assert_ne!(a, b, "nonce must be fresh per encryption");
        assert_eq!(c.decrypt(&a).unwrap(), "same input");
        assert_eq!(c.decrypt(&b).unwrap(), "same input");
    }

    #[test]
    fn legacy_plaintext_passes_through_unchanged() {
        let c = DbCipher::with_fixed_key(7);
        assert_eq!(c.decrypt("plain legacy row").unwrap(), "plain legacy row");
        assert_eq!(c.decrypt("").unwrap(), "");
    }

    #[test]
    fn is_encrypted_detects_the_prefix_only() {
        let c = DbCipher::with_fixed_key(7);
        let enc = c.encrypt("x").unwrap();
        assert!(DbCipher::is_encrypted(&enc));
        assert!(!DbCipher::is_encrypted("plain"));
        assert!(!DbCipher::is_encrypted("encv1"));
    }

    #[test]
    fn tampered_ciphertext_fails_to_decrypt_rather_than_returning_garbage() {
        let c = DbCipher::with_fixed_key(7);
        let mut enc = c.encrypt("secret").unwrap();
        enc.push('f');
        assert!(c.decrypt(&enc).is_err());
    }

    #[test]
    fn wrong_key_fails_to_decrypt() {
        let a = DbCipher::with_fixed_key(1);
        let b = DbCipher::with_fixed_key(2);
        let enc = a.encrypt("secret").unwrap();
        assert!(b.decrypt(&enc).is_err());
    }

    #[test]
    fn malformed_prefixed_value_is_an_error_not_a_panic() {
        let c = DbCipher::with_fixed_key(7);
        assert!(c.decrypt("encv1:onlyonepart").is_err());
        assert!(c.decrypt("encv1:zz:zz").is_err());
    }
}

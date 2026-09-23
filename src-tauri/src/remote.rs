//! LAN remote-control bridge — a small hand-rolled HTTP server (raw
//! `TcpListener`, not a framework) that lets a companion app on the same
//! network send a bounded set of commands to this desktop instance.
//!
//! # Phase 7 security/reliability hardening — what changed and why
//! This module existed before this pass with a real design flaw: the only
//! protection was a single long-lived token compared with a constant-time
//! equality check, sent in cleartext over plain HTTP, with `/status`
//! authenticating via a URL query parameter (which ends up in logs,
//! browser history, and proxy access logs far more often than a header
//! does), no limit on repeated wrong-token guesses, no expiry, no way to
//! invalidate a token short of restarting the whole bridge, and a
//! `Access-Control-Allow-Origin: *` response header that would have let
//! ANY webpage open in a browser on the same machine/LAN read this
//! server's responses via `fetch()` — a drive-by cross-site request
//! forgery vector with no relation to the companion app this bridge is
//! actually for.
//!
//! None of that touches the Rust `PolicyEngine`/`ToolRegistry` boundary —
//! that invariant is preserved exactly as it was: `RemoteCommand::SendText`
//! still only ever reaches the frontend via `app.emit("remote-command",
//! ...)`, which `App.tsx` feeds into the SAME `handleSend` pipeline local
//! text input uses. There is still no `confirm_action`-equivalent in
//! `RemoteCommand`, so a remote caller cannot approve a HIGH_RISK/CRITICAL
//! confirmation dialog on the user's behalf — that boundary was already
//! correct and is untouched here.
//!
//! What this pass adds:
//! 1. Header-based auth (`Authorization: Bearer <token>`) as the primary
//!    mechanism for `/status` and `/command`, so the token no longer needs
//!    to travel in a URL for normal API calls. `/pair` still takes the
//!    token as a query parameter — that endpoint's entire purpose is to be
//!    a shareable/scannable link for a human or a companion app's initial
//!    handshake, which structurally requires it to be embeddable in a URL.
//!    This is documented as the one remaining query-token exposure rather
//!    than silently left in place.
//! 2. Per-IP failed-attempt rate limiting with a lockout window.
//! 3. Token expiry (session-bounded) plus an explicit `rotate_token()` the
//!    user can trigger from the UI at any time, without restarting the
//!    listener — the running server reads the CURRENT token out of a
//!    shared `Arc<Mutex<AuthState>>` on every request rather than a value
//!    captured once at spawn time, which is what makes live rotation
//!    possible at all.
//! 4. Every auth failure, lockout, and successful remote command now
//!    writes a real `audit_logs` row via the existing `AuditLog` — the
//!    same append-only store every local action already uses, not a
//!    second logging system.
//! 5. The `Access-Control-Allow-Origin: *` response header is gone.
//!
//! # What is still NOT solved (stated plainly, not hidden)
//! This remains plain HTTP, not HTTPS — a passive observer on the same
//! LAN segment can still see the token and command bodies in transit.
//! Standing up TLS for a hand-rolled `TcpListener` server (self-signed
//! cert generation, distribution to the companion app, certificate
//! pinning) is a substantially larger change than a hardening pass, and is
//! called out explicitly as follow-up work rather than attempted halfway.
//! Mitigations that ARE in place given that constraint: short-lived,
//! rotatable tokens; per-IP lockout; and the bridge only ever binds/starts
//! when the user explicitly requests it from the UI (unchanged from
//! before this pass).

use crate::audit::{AuditEntry, AuditLog};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{Duration as StdDuration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use uuid::Uuid;

const PORT_START: u16 = 47820;
const PORT_END: u16 = 47829;
const MAX_REQUEST_BYTES: usize = 32 * 1024;
const MAX_COMMAND_TEXT: usize = 4000;

/// How long a pairing token is valid for after `start()`/`rotate_token()`
/// before it is rejected outright, regardless of whether it still matches.
/// A LAN pairing session is inherently bounded anyway (the bridge is
/// off-by-default and only runs while the desktop app is open), so this
/// is a defense-in-depth cap, not the primary access control.
const TOKEN_TTL_HOURS: i64 = 12;

/// Failed-attempt rate limiting, per source IP.
const MAX_FAILED_ATTEMPTS: u32 = 5;
const FAILURE_WINDOW: StdDuration = StdDuration::from_secs(5 * 60);
const LOCKOUT_DURATION: StdDuration = StdDuration::from_secs(15 * 60);

#[derive(Debug, Clone, Serialize)]
pub struct RemoteBridgeInfo {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub token: String,
    pub pair_url: String,
    /// RFC3339 timestamp — surfaced so the UI can show a real expiry/
    /// countdown instead of an opaque "on" state.
    pub expires_at: String,
    /// A simple aggregate count of failed-auth attempts since the bridge
    /// last started (or was last rotated-and-reset) — enough for the UI
    /// to show "N failed attempts recently" without exposing raw IPs.
    pub failed_attempts_recent: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RemoteStatus {
    pub state: String,
    pub mic_status: String,
    pub camera_status: String,
    pub online: bool,
    pub active_provider: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RemoteCommand {
    SendText { text: String },
    OpenView { view: String },
    StartListening,
    StopListening,
    StartScreenCapture,
    StopScreenCapture,
}

#[derive(Debug, Deserialize)]
struct RemoteCommandEnvelope {
    #[serde(default)]
    token: Option<String>,
    #[serde(flatten)]
    command: RemoteCommand,
}

/// The one piece of mutable auth state the running listener consults on
/// every request. Held behind `Arc<Mutex<_>>` and shared with the spawned
/// `serve` task specifically so `rotate_token()` can change it while the
/// listener keeps running — the previous design captured the token as a
/// plain owned `String` at spawn time, which made rotation without a full
/// restart impossible.
struct AuthState {
    token: String,
    expires_at: DateTime<Utc>,
}

#[derive(Default)]
struct FailureRecord {
    count: u32,
    window_started_at: Option<Instant>,
    locked_until: Option<Instant>,
}

/// Per-IP failed-attempt tracking, reset whenever the bridge is
/// (re)started or the token is rotated (a fresh token invalidates whatever
/// an attacker was guessing against anyway).
struct RateLimiter {
    records: Mutex<HashMap<IpAddr, FailureRecord>>,
    total_recent_failures: Mutex<u32>,
}

impl RateLimiter {
    fn new() -> Self {
        Self { records: Mutex::new(HashMap::new()), total_recent_failures: Mutex::new(0) }
    }

    /// `Err(seconds_remaining)` if this IP is currently locked out.
    fn check_locked(&self, ip: IpAddr) -> Result<(), u64> {
        let records = self.records.lock().unwrap();
        if let Some(rec) = records.get(&ip) {
            if let Some(until) = rec.locked_until {
                let now = Instant::now();
                if now < until {
                    return Err((until - now).as_secs());
                }
            }
        }
        Ok(())
    }

    fn record_failure(&self, ip: IpAddr) {
        {
            let mut records = self.records.lock().unwrap();
            let rec = records.entry(ip).or_default();
            let now = Instant::now();
            let window_expired = rec
                .window_started_at
                .map(|t| now.duration_since(t) > FAILURE_WINDOW)
                .unwrap_or(true);
            if window_expired {
                rec.count = 0;
                rec.window_started_at = Some(now);
            }
            rec.count += 1;
            if rec.count >= MAX_FAILED_ATTEMPTS {
                rec.locked_until = Some(now + LOCKOUT_DURATION);
            }
        }
        let mut total = self.total_recent_failures.lock().unwrap();
        *total = total.saturating_add(1);
    }

    /// A successful auth clears THIS IP's failure streak (so a genuine
    /// companion app that mistypes a token a couple of times isn't
    /// permanently penalized once it gets it right) — it does NOT reset
    /// the aggregate `total_recent_failures` counter the UI shows, since
    /// that is meant to reflect "has anything been probing this bridge",
    /// not just the currently-authenticated caller's own history.
    fn record_success(&self, ip: IpAddr) {
        self.records.lock().unwrap().remove(&ip);
    }

    fn recent_failure_count(&self) -> u32 {
        *self.total_recent_failures.lock().unwrap()
    }

    fn reset(&self) {
        self.records.lock().unwrap().clear();
        *self.total_recent_failures.lock().unwrap() = 0;
    }
}

struct RuntimeState {
    enabled: bool,
    host: String,
    port: u16,
    auth: Arc<Mutex<AuthState>>,
    limiter: Arc<RateLimiter>,
    handle: Option<JoinHandle<()>>,
    status: Arc<Mutex<RemoteStatus>>,
}

pub struct RemoteControl {
    runtime: Mutex<RuntimeState>,
}

fn new_token_and_expiry() -> (String, DateTime<Utc>) {
    (Uuid::new_v4().simple().to_string(), Utc::now() + ChronoDuration::hours(TOKEN_TTL_HOURS))
}

impl RemoteControl {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(RuntimeState {
                enabled: false,
                host: detect_lan_ip(),
                port: 0,
                auth: Arc::new(Mutex::new(AuthState { token: String::new(), expires_at: Utc::now() })),
                limiter: Arc::new(RateLimiter::new()),
                handle: None,
                status: Arc::new(Mutex::new(RemoteStatus::default())),
            }),
        }
    }

    fn snapshot_info(runtime: &RuntimeState) -> RemoteBridgeInfo {
        let auth = runtime.auth.lock().unwrap();
        RemoteBridgeInfo {
            enabled: runtime.enabled,
            host: runtime.host.clone(),
            port: runtime.port,
            token: auth.token.clone(),
            pair_url: if runtime.enabled { pairing_url(&runtime.host, runtime.port, &auth.token) } else { String::new() },
            expires_at: auth.expires_at.to_rfc3339(),
            failed_attempts_recent: runtime.limiter.recent_failure_count(),
        }
    }

    pub async fn start(&self, app: AppHandle, audit: Arc<AuditLog>) -> Result<RemoteBridgeInfo, String> {
        {
            let runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
            if runtime.enabled {
                return Ok(Self::snapshot_info(&runtime));
            }
        }

        let (token, expires_at) = new_token_and_expiry();
        let (host, auth, limiter) = {
            let mut runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
            runtime.host = detect_lan_ip();
            *runtime.auth.lock().map_err(|_| "auth state lock poisoned")? = AuthState { token: token.clone(), expires_at };
            runtime.limiter.reset();
            (runtime.host.clone(), runtime.auth.clone(), runtime.limiter.clone())
        };

        let mut selected = None;
        for port in PORT_START..=PORT_END {
            if let Ok(listener) = TcpListener::bind(("0.0.0.0", port)).await {
                selected = Some((port, listener));
                break;
            }
        }
        let (port, listener) = selected.ok_or_else(|| format!("no remote-control port available in {PORT_START}-{PORT_END}"))?;

        let status = {
            let mut runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
            runtime.enabled = true;
            runtime.port = port;
            runtime.status.clone()
        };

        let handle = tokio::spawn(async move {
            serve(listener, app, auth, limiter, status, audit).await;
        });

        let mut runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
        runtime.handle = Some(handle);
        Ok(Self::snapshot_info(&runtime))
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
        runtime.enabled = false;
        runtime.port = 0;
        {
            let mut auth = runtime.auth.lock().map_err(|_| "auth state lock poisoned")?;
            auth.token.clear();
        }
        runtime.limiter.reset();
        if let Some(handle) = runtime.handle.take() {
            handle.abort();
        }
        Ok(())
    }

    pub fn info(&self) -> Result<RemoteBridgeInfo, String> {
        let runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
        Ok(Self::snapshot_info(&runtime))
    }

    /// Issues a fresh token and expiry WITHOUT restarting the listener —
    /// the running `serve` task reads `auth` live on every request, so
    /// this takes effect immediately. Also resets the rate limiter, since
    /// a rotated token makes any in-progress guessing streak moot and it
    /// would be confusing for a stale "N failed attempts" count to persist
    /// across a deliberate rotation the user just triggered.
    pub fn rotate_token(&self) -> Result<RemoteBridgeInfo, String> {
        let runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
        if !runtime.enabled {
            return Err("remote bridge is not running".to_string());
        }
        let (token, expires_at) = new_token_and_expiry();
        *runtime.auth.lock().map_err(|_| "auth state lock poisoned")? = AuthState { token, expires_at };
        runtime.limiter.reset();
        Ok(Self::snapshot_info(&runtime))
    }

    pub fn update_status(&self, status: RemoteStatus) -> Result<(), String> {
        let runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
        let mut current = runtime.status.lock().map_err(|_| "remote status lock poisoned")?;
        *current = status;
        Ok(())
    }

    pub fn current_status(&self) -> Result<RemoteStatus, String> {
        let runtime = self.runtime.lock().map_err(|_| "remote bridge lock poisoned")?;
        let status = runtime.status.lock().map_err(|_| "remote status lock poisoned")?.clone();
        Ok(status)
    }
}

fn pairing_url(host: &str, port: u16, token: &str) -> String {
    format!("http://{host}:{port}/pair?token={token}")
}

fn detect_lan_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|socket| {
            let _ = socket.connect("8.8.8.8:80");
            socket.local_addr().ok()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

async fn serve(
    listener: TcpListener,
    app: AppHandle,
    auth: Arc<Mutex<AuthState>>,
    limiter: Arc<RateLimiter>,
    status: Arc<Mutex<RemoteStatus>>,
    audit: Arc<AuditLog>,
) {
    loop {
        let accepted = listener.accept().await;
        let (stream, peer_addr) = match accepted {
            Ok(value) => value,
            Err(_) => break,
        };
        let app = app.clone();
        let auth = auth.clone();
        let limiter = limiter.clone();
        let status = status.clone();
        let audit = audit.clone();
        tokio::spawn(async move {
            let _ = handle_connection(stream, peer_addr.ip(), app, auth, limiter, status, audit).await;
        });
    }
}

/// Records a remote-bridge access event to the SAME append-only audit log
/// every local action already writes to — a distinct `tool_id`
/// (`remote_bridge`) so it's identifiable, not a second logging system.
/// This is connection-level visibility (who tried to reach the bridge and
/// whether they were let in), separate from and in addition to whatever
/// audit row a resulting `SendText` command generates once it reaches
/// `request_action`/`confirm_action` through the normal frontend flow.
fn audit_remote_event(audit: &AuditLog, peer_ip: IpAddr, endpoint: &str, outcome: &str, detail: Option<&str>) {
    let user_request = format!("remote bridge: {endpoint} from {peer_ip}");
    let _ = audit.record(AuditEntry {
        user_request: &user_request,
        interpreted_intent: "remote_bridge_access",
        tool_id: "remote_bridge",
        params: "{}",
        risk_level: "LOW_RISK",
        confirmation_status: "not_required",
        execution_status: outcome,
        result: if outcome == "success" { detail } else { None },
        error: if outcome != "success" { detail } else { None },
    });
}

/// Checks rate-limit lockout, then token validity/expiry, writing the
/// appropriate audit row and HTTP response for either failure case.
/// Returns `Ok(true)` if the caller is authorized to proceed, `Ok(false)`
/// if a response (401/429) has already been written and the caller should
/// stop, `Err` only on a genuine I/O failure writing that response.
async fn authorize(
    stream: &mut TcpStream,
    peer_ip: IpAddr,
    supplied: &str,
    auth: &Arc<Mutex<AuthState>>,
    limiter: &RateLimiter,
    audit: &AuditLog,
    endpoint: &str,
) -> Result<bool, String> {
    if let Err(retry_after) = limiter.check_locked(peer_ip) {
        audit_remote_event(audit, peer_ip, endpoint, "blocked", Some("rate limited"));
        write_json(
            stream,
            429,
            serde_json::json!({"ok": false, "error": "too_many_attempts", "retry_after_seconds": retry_after}),
        )
        .await?;
        return Ok(false);
    }

    let (current_token, expires_at) = {
        let state = auth.lock().map_err(|_| "auth state lock poisoned".to_string())?;
        (state.token.clone(), state.expires_at)
    };
    let expired = Utc::now() > expires_at;
    let token_matches = !current_token.is_empty() && constant_time_eq(supplied, &current_token);

    if expired || !token_matches {
        limiter.record_failure(peer_ip);
        let reason = if expired { "token expired" } else { "invalid token" };
        audit_remote_event(audit, peer_ip, endpoint, "denied", Some(reason));
        let error_code = if expired { "token_expired" } else { "unauthorized" };
        write_json(stream, 401, serde_json::json!({"ok": false, "error": error_code})).await?;
        return Ok(false);
    }

    limiter.record_success(peer_ip);
    Ok(true)
}

/// Extracts a bearer token from `Authorization: Bearer <token>`. Headers
/// were already lowercased by `parse_http_request`.
fn bearer_token(headers: &HashMap<String, String>) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string())
}

async fn handle_connection(
    mut stream: TcpStream,
    peer_ip: IpAddr,
    app: AppHandle,
    auth: Arc<Mutex<AuthState>>,
    limiter: Arc<RateLimiter>,
    status: Arc<Mutex<RemoteStatus>>,
    audit: Arc<AuditLog>,
) -> Result<(), String> {
    let request = read_request(&mut stream).await?;
    let parsed = parse_http_request(&request)?;
    let method = parsed.0;
    let target = parsed.1;
    let headers = parsed.2;
    let body = parsed.3;

    match method.as_str() {
        "GET" if target.path == "/health" => {
            write_json(&mut stream, 200, serde_json::json!({"ok": true, "service": "jarvis-remote"})).await
        }
        "GET" if target.path == "/pair" => {
            // The one endpoint that still authenticates via a query
            // parameter — see this file's module doc comment for why that
            // is inherent to a shareable pairing link rather than an
            // oversight.
            let supplied = target.query.get("token").cloned().unwrap_or_default();
            if !authorize(&mut stream, peer_ip, &supplied, &auth, &limiter, &audit, "/pair").await? {
                return Ok(());
            }
            audit_remote_event(&audit, peer_ip, "/pair", "success", None);
            write_json(&mut stream, 200, serde_json::json!({
                "ok": true,
                "service": "jarvis-remote",
                "version": 1,
                "commands": [
                    "send_text",
                    "open_view",
                    "start_listening",
                    "stop_listening",
                    "start_screen_capture",
                    "stop_screen_capture"
                ]
            })).await
        }
        "GET" if target.path == "/status" => {
            // Header-only now — this endpoint is meant for programmatic
            // polling by a companion app, not a browser link, so there is
            // no reason for its token to ever travel in a URL.
            let supplied = bearer_token(&headers).unwrap_or_default();
            if !authorize(&mut stream, peer_ip, &supplied, &auth, &limiter, &audit, "/status").await? {
                return Ok(());
            }
            audit_remote_event(&audit, peer_ip, "/status", "success", None);
            let current = status.lock().map_err(|_| "remote status lock poisoned")?.clone();
            write_json(&mut stream, 200, serde_json::json!({"ok": true, "status": current})).await
        }
        "POST" if target.path == "/command" => {
            let envelope: RemoteCommandEnvelope = serde_json::from_slice(&body)
                .map_err(|_| "invalid command JSON".to_string())?;
            // Header auth is preferred; a token in the JSON body is still
            // accepted for this endpoint (it was never in a URL/query
            // string here, so it carries none of the log/history exposure
            // `/status`'s old query-token design had) so an
            // already-integrated companion client is not broken by this
            // pass, but new clients should prefer the header.
            let supplied = bearer_token(&headers).or_else(|| envelope.token.clone()).unwrap_or_default();
            if !authorize(&mut stream, peer_ip, &supplied, &auth, &limiter, &audit, "/command").await? {
                return Ok(());
            }
            if let Err(reason) = validate_command(&envelope.command) {
                audit_remote_event(&audit, peer_ip, "/command", "failed", Some(&reason));
                return write_json(&mut stream, 400, serde_json::json!({"ok": false, "error": reason})).await;
            }
            let command_kind = command_kind_label(&envelope.command);
            app.emit("remote-command", envelope.command)
                .map_err(|e| format!("failed to dispatch remote command: {e}"))?;
            audit_remote_event(&audit, peer_ip, "/command", "success", Some(command_kind));
            write_json(&mut stream, 202, serde_json::json!({"ok": true, "accepted": true})).await
        }
        _ => {
            let _ = headers;
            write_json(&mut stream, 404, serde_json::json!({"ok": false, "error": "not_found"})).await
        }
    }
}

fn command_kind_label(command: &RemoteCommand) -> &'static str {
    match command {
        RemoteCommand::SendText { .. } => "send_text",
        RemoteCommand::OpenView { .. } => "open_view",
        RemoteCommand::StartListening => "start_listening",
        RemoteCommand::StopListening => "stop_listening",
        RemoteCommand::StartScreenCapture => "start_screen_capture",
        RemoteCommand::StopScreenCapture => "stop_screen_capture",
    }
}

fn validate_command(command: &RemoteCommand) -> Result<(), String> {
    match command {
        RemoteCommand::SendText { text } => {
            if text.trim().is_empty() { return Err("command text is empty".into()); }
            if text.chars().count() > MAX_COMMAND_TEXT { return Err("command text is too long".into()); }
        }
        RemoteCommand::OpenView { view } => {
            if !matches!(view.as_str(), "assistant" | "dashboard" | "settings" | "design") {
                return Err("unsupported view".into());
            }
        }
        RemoteCommand::StartListening
        | RemoteCommand::StopListening
        | RemoteCommand::StartScreenCapture
        | RemoteCommand::StopScreenCapture => {}
    }
    Ok(())
}

struct ParsedTarget {
    path: String,
    query: HashMap<String, String>,
}

fn parse_http_request(request: &[u8]) -> Result<(String, ParsedTarget, HashMap<String, String>, Vec<u8>), String> {
    let header_end = request.windows(4).position(|w| w == b"\r\n\r\n").ok_or_else(|| "malformed HTTP request".to_string())?;
    let head = std::str::from_utf8(&request[..header_end]).map_err(|_| "invalid HTTP headers".to_string())?;
    let body = request[header_end + 4..].to_vec();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().ok_or_else(|| "missing request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("").to_string();
    let raw_target = request_parts.next().unwrap_or("/");
    let (path, raw_query) = raw_target.split_once('?').unwrap_or((raw_target, ""));
    let query = parse_query(raw_query);
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    Ok((method, ParsedTarget { path: path.to_string(), query }, headers, body))
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (percent_decode(k), percent_decode(v)))
        .collect()
}

fn percent_decode(input: &str) -> String {
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_value(bytes[i + 1]);
            let lo = hex_value(bytes[i + 2]);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

async fn read_request(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk).await.map_err(|e| format!("HTTP read failed: {e}"))?;
        if n == 0 { break; }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_REQUEST_BYTES { return Err("request too large".into()); }
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            let head_end = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
            let head = std::str::from_utf8(&buf[..head_end]).map_err(|_| "invalid headers".to_string())?;
            let content_length = head
                .lines()
                .find_map(|line| line.strip_prefix("Content-Length:").or_else(|| line.strip_prefix("content-length:")))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            let target = head_end.saturating_add(content_length);
            while buf.len() < target {
                let n = stream.read(&mut chunk).await.map_err(|e| format!("HTTP body read failed: {e}"))?;
                if n == 0 { break; }
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > MAX_REQUEST_BYTES { return Err("request too large".into()); }
            }
            return Ok(buf);
        }
    }
    Err("incomplete HTTP request".into())
}

/// No `Access-Control-Allow-Origin` header — see this file's module doc
/// comment. A raw HTTP client (the intended companion app) is unaffected;
/// a browser page is now subject to the normal same-origin policy instead
/// of being explicitly told it may read this server's responses cross-origin.
async fn write_json(stream: &mut TcpStream, status: u16, payload: serde_json::Value) -> Result<(), String> {
    let body = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let status_text = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        429 => "Too Many Requests",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await.map_err(|e| format!("HTTP write failed: {e}"))?;
    stream.write_all(&body).await.map_err(|e| format!("HTTP body write failed: {e}"))?;
    Ok(())
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let aa = a.as_bytes();
    let bb = b.as_bytes();
    let mut diff = aa.len() ^ bb.len();
    let max = aa.len().max(bb.len());
    for i in 0..max {
        diff |= aa.get(i).copied().unwrap_or(0) as usize ^ bb.get(i).copied().unwrap_or(0) as usize;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_supported_views() {
        assert!(validate_command(&RemoteCommand::OpenView { view: "settings".into() }).is_ok());
        assert!(validate_command(&RemoteCommand::OpenView { view: "shell".into() }).is_err());
    }

    #[test]
    fn rejects_large_remote_text() {
        let text = "x".repeat(MAX_COMMAND_TEXT + 1);
        assert!(validate_command(&RemoteCommand::SendText { text }).is_err());
    }

    #[test]
    fn constant_time_compare_matches_exact_token() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
    }

    #[test]
    fn bearer_token_extracts_from_authorization_header() {
        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), "Bearer abc123".to_string());
        assert_eq!(bearer_token(&headers), Some("abc123".to_string()));
    }

    #[test]
    fn bearer_token_absent_without_header() {
        let headers = HashMap::new();
        assert_eq!(bearer_token(&headers), None);
    }

    #[test]
    fn bearer_token_ignores_non_bearer_scheme() {
        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), "Basic dXNlcjpwYXNz".to_string());
        assert_eq!(bearer_token(&headers), None);
    }

    #[test]
    fn rate_limiter_locks_out_after_max_failed_attempts() {
        let limiter = RateLimiter::new();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        for _ in 0..MAX_FAILED_ATTEMPTS {
            assert!(limiter.check_locked(ip).is_ok());
            limiter.record_failure(ip);
        }
        assert!(limiter.check_locked(ip).is_err());
    }

    #[test]
    fn rate_limiter_success_clears_that_ips_streak() {
        let limiter = RateLimiter::new();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        limiter.record_failure(ip);
        limiter.record_failure(ip);
        limiter.record_success(ip);
        // A fresh streak after a success should not immediately lock out.
        for _ in 0..(MAX_FAILED_ATTEMPTS - 1) {
            limiter.record_failure(ip);
        }
        assert!(limiter.check_locked(ip).is_ok());
    }

    #[test]
    fn rate_limiter_tracks_ips_independently() {
        let limiter = RateLimiter::new();
        let ip_a: IpAddr = "127.0.0.1".parse().unwrap();
        let ip_b: IpAddr = "10.0.0.5".parse().unwrap();
        for _ in 0..MAX_FAILED_ATTEMPTS {
            limiter.record_failure(ip_a);
        }
        assert!(limiter.check_locked(ip_a).is_err());
        assert!(limiter.check_locked(ip_b).is_ok());
    }

    #[test]
    fn rate_limiter_reset_clears_lockouts_and_aggregate_count() {
        let limiter = RateLimiter::new();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        for _ in 0..MAX_FAILED_ATTEMPTS {
            limiter.record_failure(ip);
        }
        assert!(limiter.check_locked(ip).is_err());
        assert_eq!(limiter.recent_failure_count(), MAX_FAILED_ATTEMPTS);
        limiter.reset();
        assert!(limiter.check_locked(ip).is_ok());
        assert_eq!(limiter.recent_failure_count(), 0);
    }

    #[test]
    fn new_token_and_expiry_is_bounded_by_ttl() {
        let (token, expires_at) = new_token_and_expiry();
        assert!(!token.is_empty());
        let remaining = expires_at - Utc::now();
        assert!(remaining.num_hours() <= TOKEN_TTL_HOURS);
        assert!(remaining.num_hours() >= TOKEN_TTL_HOURS - 1);
    }
}

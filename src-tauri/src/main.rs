#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod audit;
mod commands;
mod memory;
mod research;
mod remote;
mod security;
#[cfg(test)]
mod security_tests;

use actions::ToolRegistry;
use audit::AuditLog;
use commands::AppState;
use memory::MemoryStore;
use security::PolicyEngine;
use std::sync::Arc;
use tauri::Manager;

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        // State that needs a resolved app data path must be set up here,
        // inside .setup(), where we have an AppHandle — Tauri v2 removed the
        // old static tauri::api::path::app_data_dir(&Config) call.
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");
            let db_path = app_data_dir.join("jarvis.sqlite");

            // Phase 7: one DB-encryption key, loaded from the OS keychain
            // (generated on first run), shared by MemoryStore and AuditLog
            // — they're separate `Connection`s onto the same SQLite file,
            // and must use the same key or each other's encrypted columns
            // would be unreadable garbage to the other.
            let db_cipher = Arc::new(
                security::DbCipher::load_or_create().expect("failed to load/create DB encryption key from OS keychain"),
            );

            let memory = Arc::new(MemoryStore::init(&db_path, db_cipher.clone()).expect("failed to init memory store"));
            let audit = Arc::new(AuditLog::new(&db_path, db_cipher.clone()).expect("failed to init audit log"));

            // Safe to run on every startup — both migrations are
            // idempotent (see their own doc comments) and only UPDATE
            // existing rows in place, never delete/recreate anything.
            match memory.migrate_encrypt_existing() {
                Ok(n) if n > 0 => tracing::info!("encrypted {n} legacy-plaintext memory row(s) at rest"),
                Ok(_) => {}
                Err(e) => tracing::warn!("memory encryption migration did not complete: {e}"),
            }
            match audit.migrate_encrypt_existing() {
                Ok(n) if n > 0 => tracing::info!("encrypted {n} legacy-plaintext audit_logs row(s) at rest"),
                Ok(_) => {}
                Err(e) => tracing::warn!("audit log encryption migration did not complete: {e}"),
            }

            app.manage(remote::RemoteControl::new());

            app.manage(AppState {
                registry: ToolRegistry::new(),
                policy: PolicyEngine::new(),
                memory,
                audit,
                plans: crate::actions::planner::PlanRegistry::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::request_action,
            commands::confirm_action,
            commands::cancel_action,
            commands::list_tools,
            commands::execute_plan,
            commands::cancel_plan,
            commands::save_design_project,
            commands::load_design_project,
            commands::list_design_projects,
            commands::save_provider_key,
            commands::elevenlabs_tts,
            commands::get_provider_key_status,
            commands::remove_provider_key,
            commands::test_provider_key_present,
            commands::load_provider_key_for_session,
            commands::add_memory,
            commands::list_memories,
            commands::get_memory,
            commands::forget_memory,
            commands::update_memory,
            commands::approve_memory,
            commands::create_conversation,
            commands::save_message,
            commands::get_conversation_messages,
            commands::list_conversations,
            commands::end_conversation,
            commands::save_settings,
            commands::load_settings,
            commands::web_research,
            commands::start_remote_control,
            commands::stop_remote_control,
            commands::remote_control_info,
            commands::rotate_remote_control_token,
            commands::update_remote_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JARVIS");
}

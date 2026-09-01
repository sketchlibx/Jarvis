#![allow(dead_code, unused_imports, unused_variables, unused_constants, unused_mut, clippy::all)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod audit;
mod commands;
mod memory;
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

            let memory = Arc::new(MemoryStore::init(&db_path).expect("failed to init memory store"));
            let audit = Arc::new(AuditLog::new(&db_path).expect("failed to init audit log"));

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
            commands::get_provider_key_status,
            commands::remove_provider_key,
            commands::test_provider_key_present,
            commands::update_memory,
            commands::approve_memory,
            commands::save_settings,
            commands::load_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JARVIS");
}

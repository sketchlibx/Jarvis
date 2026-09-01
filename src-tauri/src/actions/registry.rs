use super::application::{CloseApplicationTool, ListRunningApplicationsTool};
use super::filesystem::{
    CopyFileTool, CreateTextFileTool, DeleteFileTool, GetFileInfoTool, ListDirectoryTool,
    MoveFileTool, ReadTextFileTool, RenameFileTool, ReplaceFileTool,
};
use super::tool::Tool;
use super::tools::{CreateFolderTool, OpenApplicationTool, OpenUrlTool, ReadClipboardTool, WriteClipboardTool};
use std::collections::HashMap;
use std::sync::Arc;

pub struct ToolRegistry {
    tools: HashMap<&'static str, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let mut tools: HashMap<&'static str, Arc<dyn Tool>> = HashMap::new();
        // Phase 1 + Phase 2 SAFE/CONTROLLED SUBSET ONLY. Anything not listed
        // here is denied by the PolicyEngine regardless of what the AI asks
        // for. No shell execution tool exists anywhere in this list — see
        // SECURITY.md "No Arbitrary Shell".
        let all: Vec<Arc<dyn Tool>> = vec![
            // Phase 1
            Arc::new(OpenUrlTool),
            Arc::new(OpenApplicationTool),
            Arc::new(ReadClipboardTool),
            Arc::new(WriteClipboardTool),
            Arc::new(CreateFolderTool),
            // Phase 2 — filesystem
            Arc::new(ListDirectoryTool),
            Arc::new(GetFileInfoTool),
            Arc::new(ReadTextFileTool),
            Arc::new(CreateTextFileTool),
            Arc::new(CopyFileTool),
            Arc::new(MoveFileTool),
            Arc::new(RenameFileTool),
            Arc::new(ReplaceFileTool),
            Arc::new(DeleteFileTool),
            // Phase 2 — application/process
            Arc::new(ListRunningApplicationsTool),
            Arc::new(CloseApplicationTool),
        ];
        for t in all {
            tools.insert(t.id(), t);
        }
        ToolRegistry { tools }
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(id).cloned()
    }

    pub fn list(&self) -> Vec<Arc<dyn Tool>> {
        self.tools.values().cloned().collect()
    }
}

/// Static allow-list check used by the PolicyEngine. Deliberately independent
/// of `ToolRegistry` instance state so a runtime-injected "tool" can never
/// bypass it. This is the single place that decides "does this tool id
/// exist at all" from a security standpoint — keep it in lockstep with the
/// list above (a unit test below checks that).
pub fn is_registered_safe_tool(id: &str) -> bool {
    matches!(
        id,
        "open_url"
            | "open_application"
            | "read_clipboard"
            | "write_clipboard"
            | "create_folder"
            | "list_directory"
            | "get_file_info"
            | "read_text_file"
            | "create_text_file"
            | "copy_file"
            | "move_file"
            | "rename_file"
            | "replace_file"
            | "delete_file"
            | "list_running_applications"
            | "close_application"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Guards against the registry and the allow-list drifting apart —
    /// every tool actually registered must also be in the static allow-list,
    /// or PolicyEngine::evaluate would deny it even when Allow was intended.
    #[test]
    fn every_registered_tool_is_in_the_allow_list() {
        let registry = ToolRegistry::new();
        for tool in registry.list() {
            assert!(
                is_registered_safe_tool(tool.id()),
                "tool '{}' is registered but missing from is_registered_safe_tool",
                tool.id()
            );
        }
    }

    #[test]
    fn arbitrary_unknown_tool_ids_are_rejected() {
        for fake in ["run_shell", "execute_command", "powershell", "cmd_exec", "sudo"] {
            assert!(!is_registered_safe_tool(fake), "'{fake}' must never be allow-listed");
        }
    }
}

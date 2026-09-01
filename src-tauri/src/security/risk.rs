use serde::{Deserialize, Serialize};

/// Risk tiers for any action JARVIS can take.
/// This enum is the single source of truth for "does this need confirmation".
/// The AI layer NEVER sets this value for an action — each Tool declares its
/// own fixed `risk_level()`, so the model cannot talk its way into a lower tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RiskLevel {
    /// Read-only or fully reversible, no side effects worth mentioning.
    Safe,
    /// Has a visible effect (opens an app/window) but is trivially undoable
    /// and not destructive.
    LowRisk,
    /// Modifies user data or system state; recoverable but not trivially so.
    HighRisk,
    /// Irreversible, destructive, or security/privacy sensitive.
    Critical,
}

impl RiskLevel {
    /// Whether this tier requires explicit user confirmation before execution.
    pub fn requires_confirmation(&self) -> bool {
        matches!(self, RiskLevel::HighRisk | RiskLevel::Critical)
    }

    pub fn label(&self) -> &'static str {
        match self {
            RiskLevel::Safe => "SAFE",
            RiskLevel::LowRisk => "LOW_RISK",
            RiskLevel::HighRisk => "HIGH_RISK",
            RiskLevel::Critical => "CRITICAL",
        }
    }
}

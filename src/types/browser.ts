export type BrowserRiskAction =
  | "open" | "navigate" | "search" | "read_page" | "click_link"   // SAFE
  | "submit_form" | "send_message" | "publish" | "purchase"
  | "upload_file" | "download_executable" | "change_account_settings" // HIGH_RISK
  | "financial_transaction" | "change_security_credentials"
  | "disable_security_control" | "irreversible_account_action";       // CRITICAL

export interface BrowserActionClassification {
  action: BrowserRiskAction;
  risk: "SAFE" | "HIGH_RISK" | "CRITICAL";
}

/** Static table — mirrors the Rust PolicyEngine's authority model. This
 * table is advisory on the frontend only; the actual gate is still the
 * Rust PolicyEngine once a browser action is routed through request_action.
 * A browser tool's Rust-side risk_level() is the one that's authoritative. */
export const BROWSER_RISK_TABLE: Record<BrowserRiskAction, "SAFE" | "HIGH_RISK" | "CRITICAL"> = {
  open: "SAFE",
  navigate: "SAFE",
  search: "SAFE",
  read_page: "SAFE",
  click_link: "SAFE",
  submit_form: "HIGH_RISK",
  send_message: "HIGH_RISK",
  publish: "HIGH_RISK",
  purchase: "HIGH_RISK",
  upload_file: "HIGH_RISK",
  download_executable: "HIGH_RISK",
  change_account_settings: "HIGH_RISK",
  financial_transaction: "CRITICAL",
  change_security_credentials: "CRITICAL",
  disable_security_control: "CRITICAL",
  irreversible_account_action: "CRITICAL",
};

export interface PageSnapshot {
  url: string;
  title: string;
  /** Plain-text extraction only — never raw HTML/JS execution results,
   * to keep the AI from being fed (or asked to generate) page scripts. */
  text: string;
}

export interface DownloadInfo {
  url: string;
  suggestedFilename: string;
  isExecutable: boolean; // .exe/.msi/.bat/.cmd/.ps1/.scr etc — see isExecutableDownload()
}

const EXECUTABLE_EXTENSIONS = [".exe", ".msi", ".bat", ".cmd", ".ps1", ".scr", ".vbs", ".jar", ".com"];

export function isExecutableDownload(filename: string): boolean {
  const lower = filename.toLowerCase();
  return EXECUTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Browser automation abstraction. Phase 2 defines the interface and
 * classification rules; the concrete implementation should be a Rust-side
 * tool (e.g. wrapping a Playwright driver process spawned with a fixed,
 * non-AI-controlled argument list — never an AI-generated command line)
 * invoked the same way filesystem tools are, through request_action.
 *
 * No method here executes arbitrary JavaScript on the page and no method
 * accepts an AI-generated script — every capability is a structured,
 * parameterized operation.
 */
export interface BrowserProvider {
  launch(): Promise<void>;
  close(): Promise<void>;
  navigate(url: string): Promise<PageSnapshot>;
  goBack(): Promise<PageSnapshot>;
  goForward(): Promise<PageSnapshot>;
  reload(): Promise<PageSnapshot>;
  search(engine: "default" | string, query: string): Promise<PageSnapshot>;
  getPageTitle(): Promise<string>;
  getPageText(): Promise<string>;
  click(selectorDescription: string): Promise<PageSnapshot>;
  type(selectorDescription: string, text: string): Promise<void>;
  select(selectorDescription: string, optionValue: string): Promise<void>;
  screenshot(): Promise<string>; // returns a file path, not inline arbitrary base64 dumped to chat
  waitForNavigation(timeoutMs?: number): Promise<PageSnapshot>;
  /** Never auto-triggered — download requires the classification above to
   * pass through PolicyEngine confirmation for executables first. */
  download(url: string): Promise<DownloadInfo>;
}

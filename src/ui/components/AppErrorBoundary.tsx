import React from "react";

interface Props { children: React.ReactNode; }
interface State { error: Error | null; }

/**
 * The command centre must never turn into a completely blank document because
 * one optional UI/3D integration threw during a render. This boundary keeps
 * the shell visible and gives us the real exception instead of hiding it.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("JARVIS render error:", error, info.componentStack);
    try {
      localStorage.setItem("jarvis.lastRenderError", JSON.stringify({
        message: error.message,
        name: error.name,
        stack: error.stack,
        componentStack: info.componentStack,
        timestamp: new Date().toISOString(),
      }));
    } catch { /* diagnostics are best-effort */ }
  }

  private recover = (): void => {
    this.setState({ error: null });
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || "Unknown render error";
    return (
      <main className="jarvis-render-error" role="alert">
        <div className="jarvis-render-error__core" aria-hidden="true" />
        <div className="jarvis-render-error__card">
          <span className="jarvis-render-error__eyebrow">JARVIS · RECOVERY</span>
          <h1>Command centre recovered</h1>
          <p>The interface hit a runtime rendering error. The desktop shell is still alive.</p>
          <code>{message}</code>
          <button type="button" onClick={this.recover}>Reload JARVIS</button>
        </div>
      </main>
    );
  }
}

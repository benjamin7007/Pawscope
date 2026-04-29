import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Human-readable name for logging + the fallback heading. */
  scope: string;
  /** Optional override fallback renderer. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  err: Error | null;
}

/**
 * Localized React error boundary. Wrap each top-level view so a hooks-rules
 * violation or render crash in one panel can't blank the whole app — the
 * surrounding shell stays usable, the user clicks "Reload section" to retry.
 *
 * Logs to the console with `[ErrorBoundary:scope]` prefix to make hunting
 * the offending component easy from devtools.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${this.props.scope}]`, err, info?.componentStack);
  }

  reset = () => this.setState({ err: null });

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    if (this.props.fallback) return this.props.fallback(err, this.reset);
    return (
      <div className="m-4 p-4 rounded-lg bg-rose-950/40 border border-rose-900/60 text-rose-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">⚠ {this.props.scope} crashed</h3>
          <button
            onClick={this.reset}
            className="text-xs px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-800/60 border border-rose-800"
          >Reload section</button>
        </div>
        <p className="text-xs text-rose-300/80 font-mono whitespace-pre-wrap break-all">
          {err.message || String(err)}
        </p>
        <p className="mt-2 text-[11px] text-rose-300/60">
          Open the browser console for the full stack trace. The rest of Pawscope is still usable.
        </p>
      </div>
    );
  }
}

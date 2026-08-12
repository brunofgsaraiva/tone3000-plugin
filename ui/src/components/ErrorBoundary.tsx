import React from 'react';
import * as Juce from '@juce-framework/webview';
import { MUTED, filledPillButtonStyle, pillButtonStyle } from './theme';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Root-level error boundary. Without this, any uncaught render error unmounts
 * the whole React tree and the plugin window goes black with no way to
 * recover. Instead we show a branded fallback with the error message, a
 * copy-logs shortcut (console output is already forwarded to the native log
 * file) and a reload button that restarts the UI in place.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const message = `UI crashed: ${error.stack ?? error.message}\nComponent stack:${
      info.componentStack ?? ' (none)'
    }`;
    // Last line of defense, so write straight to the native log via the
    // explicit API instead of relying on the console.* forwarding shim.
    try {
      void Juce.getNativeFunction('webLog')('error', message);
    } catch {
      // Not running inside the plugin (plain browser dev); the console
      // below is visible there anyway.
    }
    console.error(message);
  }

  private copyLogs = () => {
    try {
      Juce.getNativeFunction('copyLogs')();
    } catch {
      // Not running inside the plugin (plain browser dev), so nothing to copy.
    }
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: '#000',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 32,
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 400 }}>Something went wrong</div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: MUTED,
            maxWidth: 360,
            maxHeight: 120,
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        >
          {this.state.error.message}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" onClick={this.reload} style={filledPillButtonStyle}>
            Reload UI
          </button>
          <button type="button" onClick={this.copyLogs} style={pillButtonStyle}>
            Copy logs
          </button>
        </div>
        <div style={{ fontSize: 12, fontWeight: 400, color: MUTED }}>
          The error has been written to the TONE3000 log file.
        </div>
      </div>
    );
  }
}

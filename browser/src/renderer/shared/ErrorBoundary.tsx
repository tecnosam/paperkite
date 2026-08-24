import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort safety net for both renderers. React unmounts the entire
 * tree on any uncaught error during render - without a boundary, one bad
 * value anywhere (a bug, a stale/racy async response, whatever) blanks
 * the whole window with no way back short of restarting the app. This
 * swaps that for a small recoverable message instead. Fixing the actual
 * bug that got caught still matters - this is a backstop, not a fix.
 *
 * Must be a class component - React has no hook equivalent for
 * componentDidCatch/getDerivedStateFromError as of React 19.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error, showing recovery UI:', error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <span className="error-boundary__kite" aria-hidden>
            🪁
          </span>
          <p>Something went wrong.</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

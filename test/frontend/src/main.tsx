import React from 'react';
import ReactDOM from 'react-dom/client';
import * as AppModule from './App';
import { AuthProvider, ToastProvider } from './app/state';
import './styles.css';

const AppComponent = (AppModule as any).App || (AppModule as any).default;

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Critical React Crash:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, backgroundColor: '#fef2f2', color: '#991b1b', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h2>🚨 CRITICAL REACT CRASH</h2>
          <p>The application encountered an error and unmounted the UI.</p>
          <pre style={{ background: '#ffffff', padding: 20, border: '1px solid #fca5a5', overflowX: 'auto', fontSize: '14px' }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button 
            onClick={() => window.location.reload()} 
            style={{ marginTop: 20, padding: "10px 20px", background: "#b91c1c", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
          >
            Reload Console
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <AppComponent />
        </ToastProvider>
      </AuthProvider>
    </RootErrorBoundary>
  </React.StrictMode>
);
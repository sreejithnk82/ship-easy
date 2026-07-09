import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ToastProvider, ConfirmProvider } from './components/feedback';
import { ActivityBar } from './components/ActivityBar';
import './index.css';

// Global error handler for mobile debugging
window.onerror = (msg, url, lineNo) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding: 20px; color: red; font-family: sans-serif;">
        <h3>App Crash Detected</h3>
        <p>${msg}</p>
        <small>${url}:${lineNo}</small>
        <button onclick="window.location.reload()" style="display: block; margin-top: 10px; padding: 10px; background: #6366f1; color: white; border: none; border-radius: 8px;">Reload App</button>
      </div>
    `;
  }
  return false;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <ActivityBar />
        <App />
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>,
);

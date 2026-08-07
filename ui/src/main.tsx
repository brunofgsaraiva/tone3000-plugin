import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// A file dropped anywhere on the plugin would make the webview navigate away
// from the UI. Swallow drags globally; components that want drops can handle
// them before the event bubbles here.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Breadcrumb in TONE3000.log (console.* is forwarded natively): confirms the
// UI booted and the log-forwarding pipeline works in every session.
console.log('TONE3000 UI booted');

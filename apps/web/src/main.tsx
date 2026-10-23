import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts ship with the app: no third-party requests, and they work offline.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/index.css';
import { App } from './App';
import { registerServiceWorker } from './lib/serviceWorker';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './lib/storage/browser';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Tier 1 Google Maps Platform Auth & Quota Defense
(window as Window & { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-auth-failure'));
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  } else if (
    msg.includes('ApiNotActivatedMapError') ||
    msg.includes('RefererNotAllowedMapError') ||
    msg.includes('InvalidKeyMapError')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-auth-failure'));
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

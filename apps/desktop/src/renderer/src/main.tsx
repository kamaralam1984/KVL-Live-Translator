import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installBrowserKvlApiShimIfNeeded } from './services/browserKvlApiShim';
import './styles/index.css';

installBrowserKvlApiShimIfNeeded();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

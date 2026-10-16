import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AboutPage } from './AboutPage';
import '../styles/tokens.css';
import '../styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <AboutPage />
  </StrictMode>,
);

import '@fontsource/lexend/400.css';
import '@fontsource/lexend/500.css';
import '@fontsource/lexend/600.css';
import '@fontsource/lexend/700.css';
import './ui/styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

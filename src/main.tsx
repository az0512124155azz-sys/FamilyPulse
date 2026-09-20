import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
import { PrivacyPage, TermsPage } from './LegalPages';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.error));
}

const path=window.location.pathname.replace(/\/+$/,'')||'/';
const Screen=path==='/privacy' ? PrivacyPage : path==='/terms' ? TermsPage : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Screen /></React.StrictMode>,
);

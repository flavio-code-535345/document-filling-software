import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import MobileSign from './pages/MobileSign.jsx';
import './styles.css';

// Minimal hash routing: #/sign?session=..&token=.. is the mobile signing page,
// everything else is the desktop studio.
const isSignRoute = window.location.hash.startsWith('#/sign');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isSignRoute ? <MobileSign /> : <App />}
  </React.StrictMode>
);

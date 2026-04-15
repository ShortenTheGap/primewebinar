import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminView from './components/AdminView';
import './index.css';

// Simple path-based routing without a router dependency.
// /admin → AdminView, everything else → main Dashboard.
const RootComponent = window.location.pathname.startsWith('/admin') ? AdminView : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);

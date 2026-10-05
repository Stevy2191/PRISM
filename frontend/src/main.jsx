import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { TimerProvider } from './context/TimerContext';
import { ThemeProvider } from './context/ThemeContext';
import { NavStyleProvider } from './context/NavStyleContext';
import { ToastProvider } from './context/ToastContext';
import { CompanyProvider } from './context/CompanyContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <NavStyleProvider>
          <ToastProvider>
            <SettingsProvider>
              <AuthProvider>
                <CompanyProvider>
                  <TimerProvider>
                    <App />
                  </TimerProvider>
                </CompanyProvider>
              </AuthProvider>
            </SettingsProvider>
          </ToastProvider>
        </NavStyleProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);

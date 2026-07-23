import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ToastHost } from './ui.jsx'
import { I18nProvider } from './i18n.jsx'
import './styles.css'

// ToastHost outermost so App (e.g. playback) can toast; I18n wraps everything.
createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <ToastHost><App /></ToastHost>
  </I18nProvider>
)

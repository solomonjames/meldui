import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import App from './App.tsx'
import { PreferencesApp } from './components/preferences/preferences-app.tsx'

const isPreferencesWindow =
  new URLSearchParams(window.location.search).get('window') === 'preferences'

// Apply saved theme before React mount to prevent flash
async function initAndRender() {
  try {
    const prefs = await invoke<{ theme: string }>('get_app_preferences')
    const mode = prefs.theme || 'system'
    const isDark =
      mode === 'dark' ||
      (mode === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', isDark)
  } catch {
    // Default: follow system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark')
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isPreferencesWindow ? <PreferencesApp /> : <App />}
    </StrictMode>,
  )
}

initAndRender()

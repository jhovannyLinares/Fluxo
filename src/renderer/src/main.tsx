import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PrefsProvider } from './prefs'
// letra de la interfaz, empaquetada: la app no carga nada de internet
import '@fontsource/open-sans/latin-400.css'
import '@fontsource/open-sans/latin-500.css'
import '@fontsource/open-sans/latin-600.css'
import './styles.css'
import { migrateStorageKeys } from './storage-migrate'

// A14: los ajustes de la ventana de cuando la app se llamaba Flux, antes de que los lea cualquier panel
migrateStorageKeys()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </StrictMode>
)

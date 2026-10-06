import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import { ConfirmProvider } from './components/ConfirmDialog'
import { loadAppConfig } from './appConfig'

const container = document.getElementById('root')

const root = createRoot(container!)

// The saved settings are read from the config file before the first render, so
// every hook starts from what the user had instead of from empty.
loadAppConfig().finally(() => {
    root.render(
        <React.StrictMode>
            <ConfirmProvider>
                <App/>
            </ConfirmProvider>
        </React.StrictMode>
    )
})

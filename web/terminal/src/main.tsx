import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { getLang, setLang } from './i18n'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
if (getLang() === 'ur') setLang('ur')

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import {initializeDesktop} from './api/transport'

void initializeDesktop().then(()=>ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)).catch(error=>{const root=document.getElementById('root');if(root){root.setAttribute('role','alert');root.textContent='客户端初始化失败：'+(error instanceof Error?error.message:'未知错误')}})

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import { sanitizeAnalyticsUrl } from './core/analytics/sanitizeAnalyticsUrl';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* 리모컨 URL fragment에 페어링 키가 있으므로 전송 전 반드시 URL을 정리한다 */}
    <Analytics beforeSend={(event) => ({ ...event, url: sanitizeAnalyticsUrl(event.url) })} />
  </React.StrictMode>
);

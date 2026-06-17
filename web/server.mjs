import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.mjs';
import { tendersRouter } from './routes/tenders.mjs';
import { contractorsRouter } from './routes/contractors.mjs';
import { paymentsRouter } from './routes/payments.mjs';
import { dashboardRouter } from './routes/dashboard.mjs';
import { awardsRouter } from './routes/awards.mjs';
import { projectsRouter } from './routes/projects.mjs';
import { exportRouter } from './routes/export.mjs';
import { alertsRouter } from './routes/alerts.mjs';
import { adminRouter } from './routes/admin.mjs';
import { startScheduler } from './scheduler.mjs';
import { preloadWarmup } from './cache.mjs';

import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// HTTPS redirect (trust Render's proxy)
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect('https://' + req.headers.host + req.url);
  }
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'طلبات كثيرة. حاول بعد 15 دقيقة.' }
});
app.use('/api/', limiter);

// API routes (these MUST come before static files)
app.use('/api/auth', authRouter);
app.use('/api/tenders', tendersRouter);
app.use('/api/contractors', contractorsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/awards', awardsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/export', exportRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/admin', adminRouter);

// Cached weather (refreshed every 10 min)
let cachedWeather = { temperature: '--', desc: '' };
let lastWeatherFetch = 0;
function getWeatherHtml(cb) {
  const now = Date.now();
  if (now - lastWeatherFetch < 600000 && cachedWeather.temperature !== '--') { cb(cachedWeather); return; }
  https.get('https://wttr.in/~24.7136,46.6753?format=j1', (r) => {
    let body = '';
    r.on('data', c => body += c);
    r.on('end', () => {
      try {
        const cc = JSON.parse(body).current_condition[0];
        cachedWeather = { temperature: cc.temp_C, desc: (cc.weatherDesc[0].value || '').trim() };
        lastWeatherFetch = now;
      } catch(e) {}
      cb(cachedWeather);
    });
  }).on('error', () => cb(cachedWeather));
}

// Weather proxy endpoint
app.get('/api/weather', (req, res) => {
  getWeatherHtml(w => res.json(w));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html & dashboard.html with weather injected
const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
const dashHtmlPath = path.join(__dirname, 'public', 'dashboard.html');
function injectWeather(html, w) {
  return html.replace('🌡️ --°C', `${w.temperature}°C · ${w.desc}`);
}
app.get('/', (req, res) => {
  getWeatherHtml(w => {
    fs.readFile(indexHtmlPath, 'utf8', (err, html) => {
      if (err) { res.sendFile(indexHtmlPath); return; }
      res.send(injectWeather(html, w));
    });
  });
});
app.get('/dashboard.html', (req, res) => {
  getWeatherHtml(w => {
    fs.readFile(dashHtmlPath, 'utf8', (err, html) => {
      if (err) { res.sendFile(dashHtmlPath); return; }
      res.send(injectWeather(html, w));
    });
  });
});

// Static files (css, js, images — not index/dashboard)
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback (must be last)
app.use((req, res) => {
  if (!req.path.startsWith('/api/')) {
    getWeatherHtml(w => {
      fs.readFile(indexHtmlPath, 'utf8', (err, html) => {
        if (err) { res.sendFile(indexHtmlPath); return; }
        res.send(injectWeather(html, w));
      });
    });
  } else {
    res.status(404).json({ error: 'المسار غير موجود' });
  }
});

app.listen(PORT, () => {
  console.log(`\n  🏗️  Government Tenders API running at:`);
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  📊  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  🔌  API: http://localhost:${PORT}/api/health\n`);
  startScheduler();
  // Warmup cache in background (non-blocking)
  const dataDir = path.join(__dirname, '..', 'data');
  preloadWarmup({
    tenders: path.join(dataDir, 'etimad_all_tenders.json'),
    contractors: path.join(dataDir, 'muqawil_all_regions.json'),
    projects: path.join(dataDir, 'projects_database.json'),
    awards_sample: path.join(dataDir, 'etimad_sample_awards.json')
  });
});

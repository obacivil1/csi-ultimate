import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env } from '../config/env.mjs';
import { logger } from '../core/logger.mjs';
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
import { contactRouter } from './routes/contact.mjs';
import { engineRouter, ENGINE_PUBLIC_DIR } from './routes/engine.mjs';
import { siteProfileRouter } from './routes/site-profile.mjs';
import { v1Router } from './routes/v1.mjs';
import { startScheduler } from './scheduler.mjs';
import { preloadWarmup } from './cache.mjs';

import https from 'https';

env.validate();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = env.PORT;

const app = express();

app.use(compression());
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || 'https://csi-ultimate.onrender.com,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// HTTPS redirect (trust Render's proxy)
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && env.NODE_ENV === 'production') {
    return res.redirect('https://' + req.headers.host + req.url);
  }
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  message: { error: 'طلبات كثيرة. حاول بعد 15 دقيقة.' }
});
app.use('/api/', limiter);

// Stricter limits on auth + payments (brute-force / account abuse)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  message: { error: 'محاولات كثيرة. حاول بعد 15 دقيقة.' }
});
app.use('/api/auth/', authLimiter);
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  message: { error: 'عملية دفع كثيرة. أعد المحاولة لاحقاً.' }
});
app.use('/api/payments/', paymentLimiter);

// API routes (these MUST come before static files)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true, time: Date.now(),
    env: {
      paypal_id: !!env.PAYPAL.CLIENT_ID,
      paypal_secret: !!env.PAYPAL.CLIENT_SECRET,
      sandbox: env.PAYPAL.SANDBOX,
      jwt: !!env.JWT_SECRET,
      node: process.version
    }
  });
});
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
app.use('/api/contact', contactRouter);
app.use('/api', siteProfileRouter);
app.use('/api', engineRouter);

// Versioned contract: /api/v1/* — يُركَّب بنفس منطق المعالجات؛ /api/* يبقى كأسماء بديلة قديمة
app.use('/api/v1/auth/', authLimiter);
app.use('/api/v1/payments/', paymentLimiter);
app.use('/api/v1', v1Router);
app.use('/engine', express.static(ENGINE_PUBLIC_DIR));

// Cached weather (refreshed every 10 min)
let cachedWeather = { temperature: '--', desc: '' };
let lastWeatherFetch = 0;
function getWeatherHtml(cb) {
  const now = Date.now();
  if (now - lastWeatherFetch < 600000 && cachedWeather.temperature !== '--') { cb(cachedWeather); return; }
  const wreq = https.get('https://wttr.in/~24.7136,46.6753?format=j1', (r) => {
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
  });
  wreq.setTimeout(8000, () => { wreq.destroy(); cb(cachedWeather); });
  wreq.on('error', () => cb(cachedWeather));
}

// Weather proxy endpoint
app.get('/api/weather', (req, res) => {
  getWeatherHtml(w => res.json(w));
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
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});
app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contact.html'));
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
  logger.info('web server started', { port: PORT, env: env.NODE_ENV });
  startScheduler();
  // Warmup cache in background (non-blocking)
  const dataDir = path.join(__dirname, '..', 'data');
  preloadWarmup({
    tenders: path.join(dataDir, 'etimad_all_tenders.json'),
    contractors: path.join(dataDir, 'muqawil_all_regions.json'),
    projects: path.join(dataDir, 'projects_database.json'),
    awards: path.join(dataDir, 'etimad_sample_awards.json'),
    awards_sample: path.join(dataDir, 'etimad_sample_awards.json')
  });
});

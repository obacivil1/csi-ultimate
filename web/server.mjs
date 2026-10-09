import express from 'express';
import helmet from 'helmet';
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
import { proxiesRouter } from './routes/proxies.mjs';
import { v1Router } from './routes/v1.mjs';
import { startScheduler, stopScheduler } from './scheduler.mjs';
import { preloadWarmup } from './cache.mjs';
import { seedFromEnv, startHealthChecks, stopHealthChecks } from '../core/proxy-pool.mjs';

import https from 'https';

env.validate();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = env.PORT;

const app = express();

// Do not advertise the framework/version to scanners
app.disable('x-powered-by');

// Behind Cloudflare + Render's proxy: trust a bounded number of hops so req.ip
// reflects the real client (not the proxy address) and rate limiting stays
// accurate. Never set this to `true` — that would let clients spoof X-Forwarded-For.
app.set('trust proxy', env.TRUST_PROXY);

// Security headers. CSP is tailored to the app's needs (inline handlers,
// Chart.js + PayPal + Turnstile + Analytics CDNs).
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://www.paypal.com', 'https://www.paypalobjects.com', 'https://www.googletagmanager.com', 'https://challenges.cloudflare.com'],
  scriptSrcAttr: ["'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'", 'https:', 'data:'],
  connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://api-m.paypal.com', 'https://api-m.sandbox.paypal.com', 'https://challenges.cloudflare.com'],
  frameSrc: ["'self'", 'https://www.paypal.com', 'https://challenges.cloudflare.com'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
};
cspDirectives.upgradeInsecureRequests = env.NODE_ENV === 'production' ? [] : null;
app.use(helmet({
  contentSecurityPolicy: { useDefaults: true, directives: cspDirectives },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
}));

app.use(compression());
const DEFAULT_ORIGINS = [
  'https://csi-ultimate.onrender.com',
  'http://localhost:3000', 'http://localhost:3030', 'http://localhost:3080', 'http://localhost:3456',
  'http://127.0.0.1:3000', 'http://127.0.0.1:3030', 'http://127.0.0.1:3080', 'http://127.0.0.1:3456',
];
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
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

// HTTPS redirect (trust Render's proxy) — with Host-header validation to prevent open redirects
const ALLOWED_HOSTS = new Set(
  [...ALLOWED_ORIGINS, 'localhost', '127.0.0.1'].map(h => {
    try { return new URL(h).hostname.toLowerCase(); } catch { return h.toLowerCase(); }
  })
);
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && env.NODE_ENV === 'production') {
    let hostname = (req.headers.host || '').split(':')[0].toLowerCase();
    let port = '';
    if (req.headers.host && req.headers.host.includes(':')) {
      const i = req.headers.host.indexOf(':');
      const maybePort = req.headers.host.slice(i + 1);
      if (/^\d+$/.test(maybePort)) port = ':' + maybePort;
    }
    if (!ALLOWED_HOSTS.has(hostname)) {
      return res.status(400).json({ error: 'المضيف غير مسموح' });
    }
    return res.redirect(`https://${hostname}${port}${req.url}`);
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

// Heavy/compute operations get their own budget (burn CPU/IO/DB if hammered)
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  message: { error: 'طلبات تصدير كثيرة. حاول بعد 15 دقيقة.' }
});
app.use('/api/export/', exportLimiter);
const engineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  message: { error: 'طلبات محرك كثيرة. حاول بعد 15 دقيقة.' }
});
app.use('/api/search', engineLimiter);
app.use('/api/scrape', engineLimiter);
app.use('/api/crawl', engineLimiter);

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

// Liveness probe لصحة الحاوية (Docker HEALTHCHECK / كيوبر/نقابة) — دون امتيازات أو تبعيات
app.get('/api/healthz', (req, res) => {
  res.json({ ok: true, pid: process.pid, uptime: Math.round(process.uptime()), time: Date.now() });
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
app.use('/api/proxies', proxiesRouter);

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

const server = app.listen(PORT, () => {
  logger.info('web server started', { port: PORT, env: env.NODE_ENV });
  if (env.PROXY) {
    seedFromEnv(env.PROXY);
    startHealthChecks(undefined, 60000);
    logger.info('proxy pool seeded', { count: env.PROXY.split(',').filter(Boolean).length });
  }
  if (env.SCHEDULER) {
    startScheduler();
  } else {
    logger.info('scheduler disabled — data updates run in GitHub Actions (set ENABLE_SCHEDULER=1 to enable in-process cron)');
  }
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

// إيقاف رشيق: يوقف الاستماع والمجدوِل وفحوصات البروكسي ثم يخرج
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn('shutdown initiated', { signal });
  stopScheduler();
  stopHealthChecks();
  server.close(() => {
    logger.info('shutdown complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

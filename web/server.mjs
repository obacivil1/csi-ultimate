import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.mjs';
import { tendersRouter } from './routes/tenders.mjs';
import { contractorsRouter } from './routes/contractors.mjs';
import { paymentsRouter } from './routes/payments.mjs';
import { dashboardRouter } from './routes/dashboard.mjs';
import { awardsRouter } from './routes/awards.mjs';
import { projectsRouter } from './routes/projects.mjs';
import { startScheduler } from './scheduler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'طلبات كثيرة. حاول بعد 15 دقيقة.' }
});
app.use('/api/', limiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/tenders', tendersRouter);
app.use('/api/contractors', contractorsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/awards', awardsRouter);
app.use('/api/projects', projectsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback (must be last)
app.use((req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
});

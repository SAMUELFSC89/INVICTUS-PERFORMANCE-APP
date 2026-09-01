import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { createProxyMiddleware } from 'http-proxy-middleware';
import apiRouter from './api/app.ts';
import { aggregationService } from './api/_lib/aggregation.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Immediate health check endpoints for Cloud Run & load balancers
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/ping', (_req, res) => res.status(200).send('pong'));
  app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  // Log e Proxy para autenticação Firebase usando domínio customizado
  app.use('/__/auth', (req, _res, next) => {
    console.log(`[Firebase Auth Proxy Request] ${req.method} ${req.originalUrl}`);
    next();
  });

  app.use(createProxyMiddleware({
    pathFilter: (path, _req) => path.startsWith('/__/auth'),
    target: 'https://gen-lang-client-0890994677.firebaseapp.com',
    changeOrigin: true,
  }));

  // Request logger - filter out static assets and noise
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[API] ${req.method} ${req.url}`);
    } else if (!req.url.includes('.') && req.method !== 'GET') {
      // Log non-get, non-file requests if any
      console.log(`[Server] ${req.method} ${req.url}`);
    }
    next();
  });

  // Middleware JSON
  app.use(express.json({ limit: '10mb' }));

  // API Routes - Using the consolidated router mounted at /api
  console.log('[Server] Mounting API routes...');
  try {
    if (apiRouter) {
      app.use('/api', apiRouter);
      console.log('[Server] API routes mounted at /api');
    } else {
      console.error('[Server] API Router is not defined');
    }
  } catch (err) {
    console.error('[Server] Failed to load API routes:', err);
  }

  // Fallback 404 for /api requests to ensure they don't fall through to Vite HTML
  app.use('/api', (req, res) => {
    console.warn(`[API 404] ${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ error: `Endpoint não encontrado: ${req.url}` });
  });

  // Background Aggregation Job
  const startBackgroundJobs = () => {
    try {
      const runJob = async () => {
        console.log('[Background Job] Running aggregation...');
        await aggregationService.updateAllStats();
      };

      // Run every 2 hours instead of 15 minutes to save Firestore quota
      setInterval(() => {
        runJob().catch(console.error);
      }, 2 * 60 * 60 * 1000);
      
    } catch (e) {
      console.warn('[Background Job] Could not start aggregation job:', e);
    }
  };

  if (process.env.NODE_ENV !== 'test') {
    startBackgroundJobs();
  }

  // Serve static files in production or use Vite middleware in development
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    } else {
      // Fallback to dev mode if dist/ doesnt exist
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

startServer().catch((err) => {
  console.error('[FATAL] Failed to start server:', err);
  process.exit(1);
});

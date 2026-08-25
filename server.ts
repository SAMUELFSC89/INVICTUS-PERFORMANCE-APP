import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { createProxyMiddleware } from 'http-proxy-middleware';

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  const PORT = 3000;

  // Immediate health check endpoints for Cloud Run & load balancers
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/ping', (req, res) => res.send('pong'));

  // Log e Proxy para autenticação Firebase usando domínio customizado
  app.use('/__/auth', (req, res, next) => {
    console.log(`[Firebase Auth Proxy Request] ${req.method} ${req.originalUrl}`);
    next();
  });

  app.use(createProxyMiddleware({
    pathFilter: (path, req) => path.startsWith('/__/auth'),
    target: 'https://gen-lang-client-0890994677.firebaseapp.com',
    changeOrigin: true,
  }));

  // Request logger - filter out static assets and noise
  app.use((req, res, next) => {
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
  console.log('[Server] Loading API routes...');
  try {
    const apiAppModule = await import('./api/app.ts');
    const apiRouter = apiAppModule.default;
    
    if (!apiRouter) {
      throw new Error('API Router not found in api/app.ts export');
    }
    
    app.use('/api', apiRouter);
    console.log('[Server] API routes mounted at /api');
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
  const startBackgroundJobs = async () => {
    try {
      const { aggregationService } = await import('./api/_lib/aggregation');
      
      const runJob = async () => {
        console.log('[Background Job] Running aggregation...');
        await aggregationService.updateAllStats();
      };

      // Run every 2 hours instead of 15 minutes to save Firestore quota
      // And remove the immediate runJob call that happens on every cold start
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
      app.get('*', (req, res) => {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

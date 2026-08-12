import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

// Handlers are imported dynamically inside the routes to prevent startup crashes
// if one of the API files has a compilation or runtime error.

const PORT = 3000;

async function runLocal() {
  const app = express();
  
  // Habilitar CORS para evitar "Failed to fetch" no frontend local
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true
  }));
  app.use(express.json());
  
  app.get('/ping', (req, res) => res.send('pong'));
  app.get('/api/heartbeat', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // Middleware de log para depuração local
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[DEV SERVER] ${req.method} ${req.path}`);
    }
    next();
  });

  const getHandler = (apiPath: string) => async (req: any, res: any) => {
    try {
      console.log(`[DEV SERVER] Loading handler for relative path: ${apiPath}`);
      
      // We use absolute path to ensure we load exactly what we want.
      // In ESM, for some versions of Node, you might need file:// prefix for absolute paths,
      // but tsx usually handles standard paths fine.
      const modulePath = path.resolve(process.cwd(), apiPath);
      console.log(`[DEV SERVER] Resolved path: ${modulePath}`);
      
      if (!fs.existsSync(modulePath)) {
        throw new Error(`API file not found at ${modulePath}`);
      }

      // Add a potential file:// prefix if we're on a version of node that needs it for absolute ESM imports
      const importPath = process.platform === 'win32' || !modulePath.startsWith('/') ? modulePath : `file://${modulePath}`;
      console.log(`[DEV SERVER] Importing from: ${importPath}`);
      
      const module = await import(importPath);
      const handler = module.default;
      
      if (!handler) {
        throw new Error(`Default export not found in ${apiPath}. Did you use "export default async function handler..."?`);
      }
      
      console.log(`[DEV SERVER] Executing ${apiPath}`);
      await handler(req, res);
      console.log(`[DEV SERVER] ${apiPath} finished`);
    } catch (err: any) {
      console.error(`[DEV SERVER] API Loading/Execution Error in ${apiPath}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false,
          error: `Erro ao carregar o backend (${apiPath}). ${err.message}`,
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
      }
    }
  };

  // Mapeamento dos handlers (Estilo Vercel)
  app.all('/api/health', getHandler('api/health.ts'));
  app.all('/api/profile', getHandler('api/profile.ts'));
  app.all('/api/ranking', getHandler('api/ranking.ts'));
  app.all('/api/ranking/', getHandler('api/ranking.ts'));
  app.all('/api/share', getHandler('api/share.ts'));
  app.all('/api/share-image', getHandler('api/share-image.ts'));
  app.all('/api/gyms', getHandler('api/gyms.ts'));
  app.all('/api/gyms/', getHandler('api/gyms.ts'));
  app.all('/api/gyms/join', getHandler('api/gyms/join.ts'));
  app.all('/api/checkout', getHandler('api/checkout.ts'));
  app.all('/api/webhook', getHandler('api/webhook.ts'));
  app.all('/api/running', getHandler('api/running.ts'));
  app.all('/api/running/', getHandler('api/running.ts'));
  app.all('/api/validate-activity', getHandler('api/validate-activity.ts'));
  app.all('/api/gyms/photo', getHandler('api/gyms/photo.ts'));
  app.all('/api/whatsapp/send', getHandler('api/whatsapp.ts'));
  app.all('/api/env-check', getHandler('api/env-check.ts'));

  // Public Share Route - Captured before Vite
  app.get('/share/:id', getHandler('api/share.ts'));

  // Fallback for missing API routes - ensure we return JSON, not HTML
  app.all('/api*', (req, res, next) => {
    // If it was already handled by one of the specific registrations above, this won't be reached
    // because they don't call next().
    
    // However, if we are here, it means no specific api route matched.
    // Check if it's really an API route
    if (req.path.startsWith('/api')) {
      return res.status(404).json({
        success: false,
        error: `Endpoint API não encontrado ou não registrado: ${req.path}`,
        method: req.method,
        available_endpoints: [
          '/api/health',
          '/api/profile',
          '/api/ranking',
          '/api/gyms',
          '/api/running',
          '/api/validate-activity',
          '/api/checkout',
          '/api/whatsapp/send'
        ]
      });
    }
    next();
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  
  app.use(vite.middlewares);
  
  app.get('*', async (req, res, next) => {
    // Se a requisição espera JSON (Accept header), redirecionar para 404 JSON se não for rota de API (já tratada)
    const acceptsJson = req.headers.accept && req.headers.accept.includes('application/json');
    
    // Se for rota de API OU se o cliente espera explicitamente JSON, não servir index.html
    const isApiRoute = req.path.startsWith('/api') || (acceptsJson && !req.path.includes('.'));
    
    if (isApiRoute) {
      if (!res.headersSent) {
        return res.status(404).json({ 
          error: 'Not Found', 
          path: req.path, 
          message: 'Solicitação de API não capturada pelos handlers registrados ou arquivo não encontrado.' 
        });
      }
      return;
    }

    // Se a requisição parece ser para um arquivo estático (com extensão) que não foi pego pelo Vite middleware
    if (path.extname(req.path)) {
      return next();
    }

    try {
      const template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
      const html = await vite.transformIndexHtml(req.url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (e) { 
      next(e); 
    }
  });

  try {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[LOCAL DEV] Server started successfully on port ${PORT}`);
      console.log(`[LOCAL DEV] Preview available at http://0.0.0.0:${PORT}`);
      console.log(`[LOCAL API] Registered endpoints:`);
      console.log(`  - /api/health`);
      console.log(`  - /api/gyms`);
      console.log(`  - /api/heartbeat`);
    }).on('error', (err) => {
      console.error('[LOCAL DEV] Failed to start server:', err);
    });
  } catch (err) {
    console.error('[LOCAL DEV] Error during server startup:', err);
  }
}

runLocal().catch(err => {
  console.error('[LOCAL DEV] Unhandled error in runLocal:', err);
});

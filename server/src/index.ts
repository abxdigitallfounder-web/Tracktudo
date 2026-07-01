import express from 'express';
import cors from 'cors';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config, hasMetaConfig } from './config/index.js';
import { initSchema, getState } from './db/index.js';
import { api } from './routes/api.js';
import { collectAll } from './services/collector.js';
import { startScheduler } from './scheduler/index.js';
import { authEnabled, isAuthenticated, requireAuth, handleLogin, handleLogout } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Confia no proxy do host (Render/etc.) para req.secure refletir o HTTPS real.
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// ---- Rotas públicas ----
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'tracktudo-server',
    metaConfigured: hasMetaConfig(),
    tokenCount: config.meta.tokens.length,
    apiVersion: config.meta.apiVersion,
    time: new Date().toISOString(),
  });
});

app.post('/api/login', handleLogin);
app.post('/api/logout', handleLogout);
app.get('/api/auth-status', (req, res) => {
  res.json({ authEnabled: authEnabled(), authenticated: isAuthenticated(req) });
});

// ---- Rotas de dados (protegidas por login, quando habilitado) ----
app.use('/api', requireAuth, api);

// ---- Frontend (produção): serve o build do Vite pela mesma origem ----
const clientDist = resolve(__dirname, '../../client/dist');
if (config.server.isProduction && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: qualquer rota que não seja /api devolve o index.html.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

initSchema();

app.listen(config.server.port, () => {
  console.log(
    `[TRACKTUDO] Backend rodando em http://localhost:${config.server.port} ` +
      `(${config.server.nodeEnv})`,
  );
  if (!authEnabled()) {
    console.warn('[TRACKTUDO] Aviso: login DESATIVADO (APP_PASSWORD vazio). Use só localmente.');
  }
  if (!hasMetaConfig()) {
    console.warn('[TRACKTUDO] Aviso: nenhum token da Meta configurado. Veja server/.env.');
    return;
  }
  startScheduler();
  // Recoleta no boot se o banco está vazio (essencial em hosts que "dormem"
  // e perdem o disco, como o Render free).
  if (!getState('last_limits_collect')) {
    console.log('[TRACKTUDO] Banco vazio: iniciando coleta inicial...');
    collectAll().catch((err) => console.error('[TRACKTUDO] Falha na coleta inicial:', err));
  }
});

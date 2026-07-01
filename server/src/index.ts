import express from 'express';
import cors from 'cors';
import { config, hasMetaConfig } from './config/index.js';
import { initSchema, getState } from './db/index.js';
import { api } from './routes/api.js';
import { collectAll } from './services/collector.js';

const app = express();

app.use(cors());
app.use(express.json());

// Health check.
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

app.use('/api', api);

initSchema();

app.listen(config.server.port, () => {
  console.log(`[TRACKTUDO] Backend rodando em http://localhost:${config.server.port}`);
  if (!hasMetaConfig()) {
    console.warn('[TRACKTUDO] Aviso: nenhum token da Meta configurado. Veja server/.env.');
    return;
  }
  // Coleta inicial automática se o banco ainda não tem dados.
  if (!getState('last_limits_collect')) {
    console.log('[TRACKTUDO] Banco vazio: iniciando coleta inicial...');
    collectAll().catch((err) => console.error('[TRACKTUDO] Falha na coleta inicial:', err));
  }
});

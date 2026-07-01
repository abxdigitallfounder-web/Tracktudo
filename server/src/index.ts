import express from 'express';
import cors from 'cors';
import { config, hasMetaConfig } from './config/index.js';

const app = express();

app.use(cors());
app.use(express.json());

// Health check — usado para confirmar que o backend está de pé.
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'tracktudo-server',
    metaConfigured: hasMetaConfig(),
    apiVersion: config.meta.apiVersion,
    time: new Date().toISOString(),
  });
});

// NOTE: rotas de dados (/api/accounts, /api/daily-spend, ...) chegam na Fase 5.

app.listen(config.server.port, () => {
  console.log(`[TRACKTUDO] Backend rodando em http://localhost:${config.server.port}`);
  if (!hasMetaConfig()) {
    console.warn(
      '[TRACKTUDO] Aviso: credenciais da Meta ausentes. ' +
        'Preencha server/.env para habilitar as coletas.',
    );
  }
});

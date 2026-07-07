import express from 'express';
import cors from 'cors';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config, hasMetaConfig } from './config/index.js';
import { initSchema } from './db/index.js';
import { api } from './routes/api.js';
import { cron } from './routes/cron.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const app = express();

// Confia no proxy do host (Render/Vercel/etc.) para req.secure refletir o HTTPS real.
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

// ---- Endpoints de cron (PÚBLICOS — validados por CRON_SECRET) ----
// Acionados por um cron externo (ex.: cron-job.org), já que hosts serverless
// (Vercel) não mantêm um processo de agendamento contínuo.
app.use('/api/cron', cron);

// ---- Rotas de dados ----
// Sem login — o app roda sem senha (uso via API/rede confiável). Não exponha
// a URL publicamente sem reintroduzir alguma proteção de acesso.
app.use('/api', api);

// ---- Frontend (produção): serve o build do Vite pela mesma origem ----
// Em hosts serverless como a Vercel, os arquivos estáticos costumam ser
// servidos direto pela CDN (nem chegam a esta função) — isto é o fallback
// para hosts tradicionais (Render, VPS, local com NODE_ENV=production).
const clientDist = resolve(__dirname, '../../client/dist');
if (config.server.isProduction && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: qualquer rota que não seja /api devolve o index.html.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

let schemaReady: Promise<void> | null = null;

/**
 * Garante que o schema do Postgres existe antes de atender requisições.
 * Idempotente e cacheada — em hosts tradicionais chamamos uma vez no boot;
 * em serverless (Vercel), cada container "frio" chama isso na 1ª requisição.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = initSchema();
  return schemaReady;
}

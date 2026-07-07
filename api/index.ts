import type { IncomingMessage, ServerResponse } from 'node:http';
import { app, ensureSchema } from '../server/src/app.js';

/**
 * Ponto de entrada da Vercel (função serverless única, catch-all para /api/*).
 * Reaproveita o mesmo Express `app` usado em hosts tradicionais (Render/local)
 * — sem `app.listen` (a Vercel chama esta função diretamente por requisição)
 * e sem node-cron (não existe processo contínuo em serverless; os jobs
 * periódicos são acionados via /api/cron/* por um cron externo — ver README).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ensureSchema();
  app(req, res);
}

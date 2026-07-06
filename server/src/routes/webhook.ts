import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config/index.js';
import { saveSale } from '../db/index.js';
import { currencyFromEnum } from '../perfectpay/status.js';

/**
 * Rotas PÚBLICAS de webhook (sem login) — a PerfectPay precisa alcançá-las de
 * fora. A segurança vem da validação do campo "token" do payload.
 */
export const webhook = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => {
      console.error(`[Webhook] Erro em ${req.method} ${req.originalUrl}:`, (err as Error).message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro interno' });
      else next(err);
    });
  };
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIntOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toStrOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

interface PerfectPayPayload {
  token?: string;
  code?: string;
  transaction_token?: string;
  sale_amount?: number | string;
  currency_enum?: number | string;
  currency_enum_key?: string;
  payment_type_enum?: number | string;
  sale_status_enum?: number | string;
  sale_status_detail?: string;
  date_created?: string;
  date_approved?: string;
  product?: { code?: string; name?: string };
  customer?: { full_name?: string; email?: string };
}

/**
 * POST /api/webhook/perfectpay
 * Recebe o postback de vendas da PerfectPay e grava/atualiza no banco.
 */
webhook.post(
  '/perfectpay',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as PerfectPayPayload;

    // Validação do token (quando configurado).
    const expected = config.perfectpay.webhookToken;
    if (expected && body.token !== expected) {
      console.warn('[Webhook] Postback com token inválido — ignorado.');
      res.status(401).json({ error: 'token inválido' });
      return;
    }

    // Usa transaction_token como chave (mesma da API) para não duplicar; cai no
    // code se o postback não trouxer o transaction_token.
    const code = toStrOrNull(body.transaction_token) ?? toStrOrNull(body.code);
    if (!code) {
      res.status(400).json({ error: 'transaction_token/code ausente no payload' });
      return;
    }

    const currencyEnum = toIntOrNull(body.currency_enum);
    await saveSale({
      code,
      saleAmount: toNum(body.sale_amount),
      currency: currencyFromEnum(currencyEnum, body.currency_enum_key),
      status: toIntOrNull(body.sale_status_enum) ?? 0,
      statusDetail: toStrOrNull(body.sale_status_detail),
      paymentType: toIntOrNull(body.payment_type_enum),
      productCode: toStrOrNull(body.product?.code),
      productName: toStrOrNull(body.product?.name),
      customerName: toStrOrNull(body.customer?.full_name),
      customerEmail: toStrOrNull(body.customer?.email),
      dateCreated: toStrOrNull(body.date_created),
      dateApproved: toStrOrNull(body.date_approved),
      raw: JSON.stringify(body),
    });

    console.log(
      `[Webhook] Venda ${code} salva (status ${body.sale_status_enum}, ` +
        `valor ${toNum(body.sale_amount)}).`,
    );
    res.json({ ok: true });
  }),
);

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config/index.js';

const COOKIE = 'tt_auth';

/** Login está ativado? (só quando APP_PASSWORD está definido) */
export function authEnabled(): boolean {
  return config.auth.password.length > 0;
}

/** Token esperado no cookie: HMAC(secret, password). */
function expectedToken(): string {
  const secret = config.auth.secret || config.auth.password;
  return createHmac('sha256', secret).update(`tracktudo:${config.auth.password}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Lê o cookie tt_auth do header (sem depender de cookie-parser). */
function readAuthCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function isAuthenticated(req: Request): boolean {
  if (!authEnabled()) return true;
  const cookie = readAuthCookie(req);
  return cookie != null && safeEqual(cookie, expectedToken());
}

/** Middleware que protege rotas de dados. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Não autenticado' });
}

/** POST /api/login — valida a senha e grava o cookie. */
export function handleLogin(req: Request, res: Response): void {
  if (!authEnabled()) {
    res.json({ ok: true, authDisabled: true });
    return;
  }
  const password = String((req.body as { password?: unknown })?.password ?? '');
  if (!password || !safeEqual(password, config.auth.password)) {
    res.status(401).json({ ok: false, error: 'Senha incorreta' });
    return;
  }
  // Secure só quando a requisição chega por HTTPS (direto ou via proxy do host).
  // Assim funciona tanto no Render (HTTPS) quanto em teste local (HTTP).
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE, expectedToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
  });
  res.json({ ok: true });
}

/** POST /api/logout — limpa o cookie. */
export function handleLogout(_req: Request, res: Response): void {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}

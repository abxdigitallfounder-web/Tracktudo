import { useEffect, useState } from 'react';
import { apiGetTokenHealth, type TokenInfo } from '../api';

const WARN_DAYS = 10;

export function TokenBanner() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  useEffect(() => {
    let alive = true;
    apiGetTokenHealth()
      .then((t) => alive && setTokens(t))
      .catch(() => {
        /* silencioso: monitor de token é secundário */
      });
    return () => {
      alive = false;
    };
  }, []);

  const problems = tokens
    .map((t) => {
      if (!t.valid || t.error) {
        return {
          level: 'danger' as const,
          msg: `Token "${t.label}" está inválido/expirado${
            t.error ? ` (${t.error})` : ''
          }. Atualize-o (META_TOKENS/META_SYSTEM_USER_TOKEN) para não perder as contas.`,
        };
      }
      if (t.daysLeft != null && t.daysLeft <= WARN_DAYS) {
        return {
          level: 'warn' as const,
          msg:
            t.daysLeft <= 0
              ? `Token "${t.label}" expira hoje! Gere um novo e atualize a variável.`
              : `Token "${t.label}" expira em ${t.daysLeft} dia(s). Renove antes para não perder as contas.`,
        };
      }
      return null;
    })
    .filter((p): p is { level: 'danger' | 'warn'; msg: string } => p !== null);

  if (problems.length === 0) return null;

  return (
    <>
      {problems.map((p, i) => (
        <div
          key={i}
          className="banner"
          style={
            p.level === 'danger'
              ? { background: 'var(--danger-soft)', borderColor: 'var(--danger)' }
              : undefined
          }
        >
          {p.level === 'danger' ? '🔴' : '⚠️'} {p.msg}
        </div>
      ))}
    </>
  );
}

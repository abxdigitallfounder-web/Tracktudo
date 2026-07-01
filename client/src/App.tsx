import { useCallback, useEffect, useState } from 'react';
import { apiAuthStatus, apiGetStatus, apiLogout, apiRefresh, type Status } from './api';
import { timeAgo } from './format';
import { LimitsPage } from './pages/LimitsPage';
import { DailySpendPage } from './pages/DailySpendPage';
import { Login } from './pages/Login';
import { TokenBanner } from './components/TokenBanner';

type Tab = 'limits' | 'daily';
type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('tracktudo-theme') as Theme) || 'light',
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tracktudo-theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

export default function App() {
  const [tab, setTab] = useState<Tab>('limits');
  const [theme, toggleTheme] = useTheme();
  const [status, setStatus] = useState<Status | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // null = ainda verificando; true/false = precisa (ou não) de login.
  const [authed, setAuthed] = useState<boolean | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const s = await apiAuthStatus();
      setAuthed(!s.authEnabled || s.authenticated);
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await apiGetStatus());
    } catch {
      /* backend pode estar reiniciando */
    }
  }, []);

  useEffect(() => {
    if (authed !== true) return;
    loadStatus();
    const t = setInterval(loadStatus, 15000);
    return () => clearInterval(t);
  }, [loadStatus, authed]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await apiRefresh();
      // Espera a coleta terminar (polling do /api/status).
      await new Promise<void>((resolve) => {
        const iv = setInterval(async () => {
          try {
            const s = await apiGetStatus();
            setStatus(s);
            if (!s.collecting) {
              clearInterval(iv);
              resolve();
            }
          } catch {
            /* ignora */
          }
        }, 2000);
      });
      setReloadKey((k) => k + 1);
    } finally {
      setRefreshing(false);
    }
  }

  const lastUpdate = status?.lastLimitsCollect;
  const collecting = status?.collecting || refreshing;

  async function handleLogout() {
    await apiLogout();
    setAuthed(false);
  }

  if (authed === null) {
    return <div className="empty" style={{ marginTop: 80 }}>Carregando…</div>;
  }
  if (authed === false) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          TRACK<span>TUDO</span>
        </div>
        <div className="tabs">
          <button
            className={`tab ${tab === 'limits' ? 'active' : ''}`}
            onClick={() => setTab('limits')}
          >
            Limites
          </button>
          <button
            className={`tab ${tab === 'daily' ? 'active' : ''}`}
            onClick={() => setTab('daily')}
          >
            Gastos Diários
          </button>
        </div>
        <span className="spacer" />
        <span className="status-line">
          {collecting ? '🔄 Coletando dados…' : `Atualizado ${timeAgo(lastUpdate ?? null)}`}
        </span>
        <button className="icon-btn" onClick={toggleTheme} title="Alternar tema">
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <button className="btn primary" onClick={handleRefresh} disabled={collecting}>
          {collecting ? 'Atualizando…' : '⟳ Atualizar agora'}
        </button>
        <button className="icon-btn" onClick={handleLogout} title="Sair">
          ⎋
        </button>
      </div>

      <TokenBanner />

      {tab === 'limits' ? (
        <LimitsPage reloadKey={reloadKey} />
      ) : (
        <DailySpendPage reloadKey={reloadKey} />
      )}
    </div>
  );
}

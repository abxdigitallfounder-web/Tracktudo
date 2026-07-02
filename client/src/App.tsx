import { useCallback, useEffect, useState } from 'react';
import { apiAuthStatus, apiGetStatus, apiLogout, apiRefresh, type Status } from './api';
import { timeAgo } from './format';
import { LimitsPage } from './pages/LimitsPage';
import { DailySpendPage } from './pages/DailySpendPage';
import { FoldersPage } from './pages/FoldersPage';
import { Login } from './pages/Login';
import { TokenBanner } from './components/TokenBanner';
import {
  IconGauge,
  IconChart,
  IconFolder,
  IconRefresh,
  IconSun,
  IconMoon,
  IconLogout,
} from './components/icons';

type Tab = 'limits' | 'daily' | 'folders';
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

  const pageTitle =
    tab === 'limits' ? 'Limites' : tab === 'daily' ? 'Gastos Diários' : 'Pastas';

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logo">T</span>
          TRACK<span style={{ color: 'var(--primary)' }}>TUDO</span>
        </div>

        <div className="nav-section">Painel</div>
        <nav className="nav">
          <button
            className={`nav-item ${tab === 'limits' ? 'active' : ''}`}
            onClick={() => setTab('limits')}
          >
            <IconGauge />
            Limites
          </button>
          <button
            className={`nav-item ${tab === 'daily' ? 'active' : ''}`}
            onClick={() => setTab('daily')}
          >
            <IconChart />
            Gastos Diários
          </button>
          <button
            className={`nav-item ${tab === 'folders' ? 'active' : ''}`}
            onClick={() => setTab('folders')}
          >
            <IconFolder />
            Pastas
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={handleRefresh} disabled={collecting}>
            <IconRefresh />
            {collecting ? 'Atualizando…' : 'Atualizar agora'}
          </button>
          <button className="nav-item" onClick={toggleTheme}>
            {theme === 'light' ? <IconMoon /> : <IconSun />}
            Tema {theme === 'light' ? 'escuro' : 'claro'}
          </button>
          <button className="nav-item" onClick={handleLogout}>
            <IconLogout />
            Sair
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-header">
          <h1 className="page-title">{pageTitle}</h1>
          <span className="spacer" />
          <span className="status-line">
            {collecting ? '🔄 Coletando dados…' : `Atualizado ${timeAgo(lastUpdate ?? null)}`}
          </span>
          <button className="btn primary" onClick={handleRefresh} disabled={collecting}>
            <IconRefresh className="btn-icon" />
            {collecting ? 'Atualizando…' : 'Atualizar agora'}
          </button>
        </div>

        <TokenBanner />

        {tab === 'limits' && <LimitsPage reloadKey={reloadKey} />}
        {tab === 'daily' && <DailySpendPage reloadKey={reloadKey} />}
        {tab === 'folders' && <FoldersPage reloadKey={reloadKey} />}
      </main>
    </div>
  );
}

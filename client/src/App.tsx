import { useCallback, useEffect, useState } from 'react';
import { apiGetStatus, apiRefresh, type Status } from './api';
import { timeAgo } from './format';
import { DashboardPage } from './pages/DashboardPage';
import { LimitsPage } from './pages/LimitsPage';
import { DailySpendPage } from './pages/DailySpendPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { FoldersPage } from './pages/FoldersPage';
import { RevenuePage } from './pages/RevenuePage';
import { TokenBanner } from './components/TokenBanner';
import {
  IconGrid,
  IconGauge,
  IconChart,
  IconTarget,
  IconFolder,
  IconMoney,
  IconRefresh,
  IconSun,
  IconMoon,
} from './components/icons';

type Tab = 'dashboard' | 'accounts' | 'daily' | 'campaigns' | 'folders' | 'revenue';
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
  const [tab, setTab] = useState<Tab>('dashboard');
  const [theme, toggleTheme] = useTheme();
  const [status, setStatus] = useState<Status | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await apiGetStatus());
    } catch {
      /* backend pode estar reiniciando */
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 15000);
    return () => clearInterval(t);
  }, [loadStatus]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      // /api/refresh processa a coleta de gastos em LOTES (necessário em hosts
      // serverless — nada roda depois que a resposta é enviada). Chama de novo
      // automaticamente até o ciclo completar (limite de segurança: 30 voltas).
      for (let i = 0; i < 30; i++) {
        const result = await apiRefresh();
        if (!result.dailySpend || result.dailySpend.done) break;
      }
      const s = await apiGetStatus().catch(() => null);
      if (s) setStatus(s);
      setReloadKey((k) => k + 1);
    } finally {
      setRefreshing(false);
    }
  }

  const lastUpdate = status?.lastLimitsCollect;
  const collecting = status?.collecting || refreshing;

  const pageTitle =
    tab === 'dashboard'
      ? 'Dashboard'
      : tab === 'accounts'
        ? 'Limites'
        : tab === 'daily'
          ? 'Gastos Diários'
          : tab === 'campaigns'
            ? 'Campanhas'
            : tab === 'revenue'
              ? 'Faturamento'
              : 'Pastas';

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
            className={`nav-item ${tab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setTab('dashboard')}
          >
            <IconGrid />
            Dashboard
          </button>
          <button
            className={`nav-item ${tab === 'accounts' ? 'active' : ''}`}
            onClick={() => setTab('accounts')}
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
            className={`nav-item ${tab === 'campaigns' ? 'active' : ''}`}
            onClick={() => setTab('campaigns')}
          >
            <IconTarget />
            Campanhas
          </button>
          <button
            className={`nav-item ${tab === 'revenue' ? 'active' : ''}`}
            onClick={() => setTab('revenue')}
          >
            <IconMoney />
            Faturamento
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

        {tab === 'dashboard' && <DashboardPage reloadKey={reloadKey} />}
        {tab === 'accounts' && <LimitsPage reloadKey={reloadKey} />}
        {tab === 'daily' && <DailySpendPage reloadKey={reloadKey} />}
        {tab === 'campaigns' && <CampaignsPage reloadKey={reloadKey} />}
        {tab === 'revenue' && <RevenuePage reloadKey={reloadKey} />}
        {tab === 'folders' && <FoldersPage reloadKey={reloadKey} />}
      </main>
    </div>
  );
}

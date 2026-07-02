import { useEffect, useMemo, useState } from 'react';
import {
  apiGetAccounts,
  apiListFolders,
  apiRenameFolder,
  apiDeleteFolder,
  apiSetAccountFolder,
  type Account,
  type Folder,
} from '../api';
import { formatMoney } from '../format';
import { StatusBadge } from '../components/widgets';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { AddAccountsModal } from '../components/AddAccountsModal';

const NO_FOLDER = -1; // chave interna para "Sem pasta"

export function FoldersPage({ reloadKey }: { reloadKey: number }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [addTo, setAddTo] = useState<Folder | null>(null);
  // "Sem pasta" começa recolhida (costuma ter muitas contas).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set([NO_FOLDER]));

  function toggleCollapse(key: number) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([apiListFolders(), apiGetAccounts()])
      .then(([f, a]) => {
        if (!alive) return;
        setFolders(f);
        setAccounts(a);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const byFolder = useMemo(() => {
    const map = new Map<number, Account[]>();
    for (const a of accounts) {
      const key = a.folderId ?? NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [accounts]);

  function handleCreated(folder: Folder, accountIds: string[]) {
    setFolders((prev) =>
      [...prev, folder].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    );
    const ids = new Set(accountIds);
    setAccounts((prev) => prev.map((a) => (ids.has(a.id) ? { ...a, folderId: folder.id } : a)));
    setShowCreate(false);
  }

  async function handleRename(f: Folder) {
    const name = window.prompt('Novo nome da pasta:', f.name)?.trim();
    if (!name || name === f.name) return;
    await apiRenameFolder(f.id, name);
    setFolders((prev) =>
      prev.map((x) => (x.id === f.id ? { ...x, name } : x)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    );
  }

  async function handleDelete(f: Folder) {
    if (!window.confirm(`Excluir a pasta "${f.name}"? As contas voltam para "Sem pasta".`)) return;
    await apiDeleteFolder(f.id);
    setFolders((prev) => prev.filter((x) => x.id !== f.id));
    setAccounts((prev) => prev.map((a) => (a.folderId === f.id ? { ...a, folderId: null } : a)));
  }

  function handleAdded(folderId: number, accountIds: string[]) {
    const ids = new Set(accountIds);
    setAccounts((prev) => prev.map((a) => (ids.has(a.id) ? { ...a, folderId } : a)));
    setAddTo(null);
  }

  async function moveAccount(accountId: string, folderId: number | null) {
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, folderId } : a)));
    await apiSetAccountFolder(accountId, folderId);
  }

  function totalsByCurrency(list: Account[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of list) out[a.currency] = (out[a.currency] ?? 0) + a.amountSpent;
    return out;
  }

  function renderAccountRow(a: Account) {
    return (
      <div key={a.id} className="folder-acc">
        <div className="folder-acc-name">
          <strong>{a.name}</strong>
          <StatusBadge account={a} />
          {a.businessName && <span className="muted"> · 🏢 {a.businessName}</span>}
        </div>
        <div className="folder-acc-right">
          <span className="muted">{formatMoney(a.amountSpent, a.currency)}</span>
          <select
            className="select"
            value={a.folderId ?? ''}
            onChange={(e) =>
              moveAccount(a.id, e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">Sem pasta</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  function renderGroup(key: number, name: string, deletable?: Folder) {
    const list = (byFolder.get(key) ?? []).sort((a, b) => b.amountSpent - a.amountSpent);
    const totals = totalsByCurrency(list);
    const isCollapsed = collapsed.has(key);
    return (
      <div className="panel" key={key}>
        <div className="folder-head">
          <button className="folder-toggle" onClick={() => toggleCollapse(key)}>
            <span className="chevron">{isCollapsed ? '▸' : '▾'}</span>
            {key === NO_FOLDER ? '📂' : '📁'} {name}{' '}
            <span className="muted" style={{ fontWeight: 400 }}>
              ({list.length})
            </span>
          </button>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 13 }}>
            {Object.entries(totals)
              .map(([cur, val]) => formatMoney(val, cur))
              .join(' · ') || '—'}
          </span>
          {deletable && (
            <>
              <button className="btn primary" onClick={() => setAddTo(deletable)}>
                + Adicionar
              </button>
              <button className="btn" onClick={() => handleRename(deletable)}>
                Renomear
              </button>
              <button className="btn" onClick={() => handleDelete(deletable)}>
                Excluir
              </button>
            </>
          )}
        </div>
        {!isCollapsed &&
          (list.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>
              Nenhuma conta aqui. Use o seletor nas contas para movê-las.
            </div>
          ) : (
            <div className="folder-list">{list.map(renderAccountRow)}</div>
          ))}
      </div>
    );
  }

  if (loading) return <div className="empty">Carregando…</div>;

  return (
    <>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setShowCreate(true)}>
          + Nova pasta
        </button>
        <span className="muted">{folders.length} pasta(s)</span>
      </div>

      {folders.map((f) => renderGroup(f.id, f.name, f))}
      {renderGroup(NO_FOLDER, 'Sem pasta')}

      {showCreate && (
        <CreateFolderModal
          accounts={accounts}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {addTo && (
        <AddAccountsModal
          folder={addTo}
          accounts={accounts}
          onClose={() => setAddTo(null)}
          onAdded={handleAdded}
        />
      )}
    </>
  );
}

import { useMemo, useState } from 'react';
import { apiCreateFolder, type Account, type Folder } from '../api';
import { formatMoney } from '../format';

interface Props {
  accounts: Account[];
  onClose: () => void;
  onCreated: (folder: Folder, accountIds: string[]) => void;
}

export function CreateFolderModal({ accounts, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.includes(q) ||
        (a.businessName?.toLowerCase().includes(q) ?? false),
    );
  }, [accounts, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));
  function toggleAllFiltered() {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const a of filtered) {
        if (allFilteredSelected) n.delete(a.id);
        else n.add(a.id);
      }
      return n;
    });
  }

  async function create() {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      const ids = [...selected];
      const folder = await apiCreateFolder(n, ids);
      onCreated(folder, ids);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>📁 Nova pasta</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        <input
          className="input"
          autoFocus
          placeholder="Nome da pasta (ex.: Cliente X)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="toolbar" style={{ margin: '10px 0 6px' }}>
          <input
            className="input search"
            placeholder="Buscar contas por nome, BM ou id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" onClick={toggleAllFiltered}>
            {allFilteredSelected ? 'Desmarcar' : 'Selecionar'} todas
          </button>
          <span className="muted">{selected.size} selecionada(s)</span>
        </div>

        <div className="modal-list">
          {filtered.length === 0 && <div className="muted center">Nenhuma conta encontrada.</div>}
          {filtered.map((a) => (
            <label key={a.id} className="check-row">
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                onChange={() => toggle(a.id)}
              />
              <span className="folder-acc-name">
                <strong>{a.name}</strong>
                {a.businessName && <span className="muted"> · 🏢 {a.businessName}</span>}
              </span>
              <span className="muted" style={{ marginLeft: 'auto' }}>
                {formatMoney(a.amountSpent, a.currency)}
              </span>
            </label>
          ))}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={create} disabled={!name.trim() || saving}>
            {saving
              ? 'Criando…'
              : `Criar pasta${selected.size ? ` com ${selected.size} conta(s)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

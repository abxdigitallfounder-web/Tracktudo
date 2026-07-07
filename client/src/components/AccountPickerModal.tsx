import { useMemo, useState } from 'react';
import type { Account } from '../api';
import { compareByStatus } from '../accountSort';

interface Props {
  accounts: Account[];
  initialSelected: string[];
  onClose: () => void;
  onConfirm: (accountIds: string[]) => void;
}

/** Modal genérico de seleção múltipla de contas (busca + checkboxes + "todas"). */
export function AccountPickerModal({ accounts, initialSelected, onClose, onConfirm }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? accounts
      : accounts.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            a.id.includes(q) ||
            (a.businessName?.toLowerCase().includes(q) ?? false),
        );
    return [...base].sort((a, b) => compareByStatus(a, b));
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>📁 Selecionar contas de anúncio</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        <div className="toolbar" style={{ margin: '4px 0 6px' }}>
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
              <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
              <span className="folder-acc-name">
                <strong>{a.name}</strong>
                {a.businessName && <span className="muted"> · 🏢 {a.businessName}</span>}
              </span>
            </label>
          ))}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => onConfirm([...selected])}>
            Aplicar {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { apiSetAccountTags, type Account } from '../api';

interface Props {
  account: Account;
  x: number;
  y: number;
  onClose: () => void;
  onSaved: (accountId: string, tags: string[]) => void;
}

export function TagMenu({ account, x, y, onClose, onSaved }: Props) {
  const [tags, setTags] = useState<string[]>(account.tags ?? []);
  const [input, setInput] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function persist(next: string[]) {
    setTags(next);
    onSaved(account.id, next);
    try {
      await apiSetAccountTags(account.id, next);
    } catch {
      /* mantém otimista; recarrega corrige se falhar */
    }
  }

  function addTag() {
    const t = input.trim();
    if (!t || tags.includes(t)) {
      setInput('');
      return;
    }
    void persist([...tags, t]);
    setInput('');
  }

  // Mantém o menu dentro da tela.
  const left = Math.min(x, window.innerWidth - 280);
  const top = Math.min(y, window.innerHeight - 200);

  return (
    <div ref={ref} className="ctx-menu" style={{ top, left }}>
      <div className="ctx-title">🏷️ Tags — {account.name}</div>
      <div className="ctx-tags">
        {tags.length === 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            Nenhuma tag ainda.
          </span>
        )}
        {tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button title="Remover" onClick={() => void persist(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        className="input"
        autoFocus
        placeholder="Nova tag + Enter"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') addTag();
        }}
      />
      <div className="muted" style={{ fontSize: 11 }}>
        Enter adiciona · Esc fecha
      </div>
    </div>
  );
}

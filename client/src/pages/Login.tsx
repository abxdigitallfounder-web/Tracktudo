import { useState } from 'react';
import { apiLogin } from '../api';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await apiLogin(password);
      if (r.ok) onSuccess();
      else setError(r.error || 'Senha incorreta');
    } catch {
      setError('Erro ao conectar ao servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ fontSize: 26 }}>
          TRACK<span>TUDO</span>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Digite a senha para acessar o painel.
        </p>
        <input
          className="input"
          type="password"
          placeholder="Senha"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary" type="submit" disabled={loading || !password}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { ArrowRight, Loader2, LockKeyhole } from 'lucide-react';
import { Modal } from './clinical-ui';
export default function Login({
  configured,
  onClose,
  onSuccess,
  onDemo,
}: {
  configured: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onDemo: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Acesse seu workspace" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="muted">Acesso exclusivo para profissionais e organizações convidados.</p>
          {!configured && (
            <div className="inline-notice">
              <LockKeyhole size={19} />
              <span>
                O Supabase ainda não está configurado. Siga o guia do repositório para conectar o
                ambiente e criar o administrador inicial.
              </span>
            </div>
          )}
          <label>
            E-mail
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="voce@clinica.com.br"
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onDemo}>
            Explorar demonstração
          </button>
          <button className="button primary" disabled={busy || !configured}>
            {busy && <Loader2 size={16} className="spin" />}Entrar <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

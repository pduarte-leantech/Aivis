'use client';
import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Activity, ArrowRight, LockKeyhole } from 'lucide-react';
function Access() {
  const router = useRouter(),
    query = useSearchParams(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('confirmation')) {
      setError('As senhas devem ser iguais.');
      setBusy(false);
      return;
    }
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: f.get('password') }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      router.push('/');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="access-page">
      <div className="brand">
        <span className="brand-mark">
          <Activity />
        </span>
        aivis.
      </div>
      <section className="panel settings-card">
        <LockKeyhole size={28} />
        <h1>Seu acesso, com segurança.</h1>
        <p className="muted">Defina uma senha para aceitar o convite da sua organização.</p>
        {query.get('error') ? (
          <p role="alert" className="form-error">
            O link expirou ou o ambiente não foi configurado. Solicite um novo convite ao
            administrador.
          </p>
        ) : (
          <form onSubmit={submit}>
            <label>
              Nova senha
              <input
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirme a senha
              <input
                name="confirmation"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <p className="muted">Use pelo menos 12 caracteres, com uma combinação única.</p>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? 'Salvando…' : 'Definir senha e entrar'}
              <ArrowRight size={16} />
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
export default function Page() {
  return (
    <Suspense>
      <Access />
    </Suspense>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { Code2, Copy, Plus, ShieldCheck } from 'lucide-react';
import type { FlexibleApi } from '@/lib/api-types';
import { date } from './clinical-ui';
export default function Integrations({
  demo,
  api,
  isAdmin,
  notify,
}: {
  demo: boolean;
  api: FlexibleApi;
  isAdmin: boolean;
  notify: (s: string) => void;
}) {
  const [keys, setKeys] = useState<
      { id: string; name: string; prefix: string; expires_at: string; revoked_at: string | null }[]
    >([]),
    [token, setToken] = useState(''),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!demo && isAdmin)
      api('keys')
        .then((d) => setKeys(d.keys))
        .catch((e) => setError(e.message));
  }, [demo, api, isAdmin]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (demo) {
        setToken('aiv_DEMONSTRACAO_SEM_VALIDADE');
        setKeys((prev) => [
          {
            id: crypto.randomUUID(),
            name,
            prefix: 'aiv_DEMO',
            expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
            revoked_at: null,
          },
          ...prev,
        ]);
      } else {
        const result = await api('keys', {
          method: 'POST',
          body: JSON.stringify({ name, scopes: ['cases:read', 'cases:write'] }),
        });
        setToken(result.token);
        const data = await api('keys');
        setKeys(data.keys);
      }
      setName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm('Revogar esta chave? Integrações que a utilizam perderão o acesso.'))
      return;
    setBusy(true);
    try {
      if (!demo) await api(`keys/${id}`, { method: 'DELETE' });
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k)),
      );
      notify('Chave revogada.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const example = `curl -X POST https://SEU-DOMINIO/api/v1/cases \\\n  -H 'Authorization: Bearer SUA_CHAVE' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"patient_name":"Paciente de teste",\n       "patient_code":"TEST-001",\n       "anamnesis":"Histórico clínico fictício para teste de integração."}'`;
  return (
    <div className="integration-grid">
      <section className="panel settings-card">
        <div className="section-icon">
          <Code2 size={24} />
        </div>
        <h2>Uma API. O mesmo cuidado.</h2>
        <p className="muted">
          Envie casos e exames do seu sistema, solicite a análise e recupere o PDF após a aprovação
          do médico na plataforma.
        </p>
        <div className="endpoint-list">
          {[
            ['POST', '/api/v1/cases', 'Criar caso'],
            ['POST', '/api/v1/cases/:id/upload', 'Enviar exame'],
            ['POST', '/api/v1/cases/:id/analyze', 'Solicitar análise'],
            ['GET', '/api/v1/cases/:id', 'Consultar resultado'],
            ['GET', '/api/v1/cases/:id/pdf', 'Obter PDF aprovado'],
            ['GET', '/api/v1/stats', 'Consultar indicadores'],
          ].map(([method, path, label]) => (
            <div key={path}>
              <span className={method === 'GET' ? 'get' : 'post'}>{method}</span>
              <code>{path}</code>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <div className="inline-notice">
          <ShieldCheck size={20} />
          <span>
            Chaves são isoladas por cliente, expiram em 90 dias e permitem até 60 requisições por
            minuto. A aprovação nunca é feita por chave de API.
          </span>
        </div>
      </section>
      <section className="panel code-panel">
        <div className="panel-heading">
          <h2>Seu primeiro caso</h2>
          <button
            className="icon-btn"
            aria-label="Copiar exemplo da API"
            onClick={() =>
              navigator.clipboard
                .writeText(example)
                .then(() => notify('Exemplo copiado.'))
                .catch(() => notify('Selecione o texto do exemplo para copiar.'))
            }
          >
            <Copy size={17} />
          </button>
        </div>
        <pre>
          <code>{example}</code>
        </pre>
        <p>
          Consulte <code>docs/API.md</code> no repositório para os formatos de resposta, limites e
          exemplos completos.
        </p>
      </section>
      <section className="panel settings-card full">
        <h2>Chaves de acesso</h2>
        <p className="muted">
          A chave completa é exibida uma única vez. Armazene-a no servidor do seu sistema.
        </p>
        {isAdmin ? (
          <>
            <form onSubmit={create} className="inline-form">
              <label className="sr-only" htmlFor="key-name">
                Nome da integração
              </label>
              <input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={80}
                required
                placeholder="Nome da integração, ex.: Prontuário"
              />
              <button className="button primary" disabled={busy || !!token}>
                <Plus size={16} />
                Gerar chave
              </button>
            </form>
            {token && (
              <div className="token-box">
                <strong>
                  {demo
                    ? 'Chave fictícia · sem acesso real'
                    : 'Copie agora. A chave não será exibida novamente.'}
                </strong>
                <code>{token}</code>
                <button
                  className="button secondary"
                  onClick={() => {
                    setToken('');
                    notify('Chave ocultada.');
                  }}
                >
                  Já salvei a chave
                </button>
              </div>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="key-list">
              {keys.map((k) => (
                <div className="connection-row" key={k.id}>
                  <div>
                    <strong>{k.name}</strong>
                    <small>
                      {k.prefix}… · Expira em {date(k.expires_at)}
                    </small>
                  </div>
                  <button
                    className="button secondary"
                    disabled={busy || !!k.revoked_at}
                    onClick={() => void revoke(k.id)}
                  >
                    {k.revoked_at ? 'Revogada' : 'Revogar'}
                  </button>
                </div>
              ))}
            </div>
            {!keys.length && <p className="muted">Nenhuma chave criada nesta organização.</p>}
          </>
        ) : (
          <p className="muted">Somente administradores podem gerenciar chaves.</p>
        )}
      </section>
    </div>
  );
}

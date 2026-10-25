'use client';
import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { FlexibleApi } from '@/lib/api-types';
import { Modal, Empty } from './clinical-ui';
export default function Team({
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
  const [members, setMembers] = useState<
      {
        user_id: string;
        display_name: string;
        role: string;
        professional_registration: string | null;
      }[]
    >(
      demo
        ? [
            {
              user_id: 'demo',
              display_name: 'Médico demonstrativo',
              role: 'admin',
              professional_registration: 'DEMO · sem validade',
            },
          ]
        : [],
    ),
    [error, setError] = useState(''),
    [invite, setInvite] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!demo && isAdmin)
      api('members')
        .then((d) => setMembers(d.members))
        .catch((e) => setError(e.message));
  }, [demo, api, isAdmin]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const body = {
      email: String(f.get('email')),
      display_name: String(f.get('name')),
      role: String(f.get('role')),
      professional_registration: String(f.get('registration')) || undefined,
    };
    try {
      if (demo) {
        setMembers((m) => [
          ...m,
          {
            user_id: crypto.randomUUID(),
            display_name: body.display_name,
            role: body.role,
            professional_registration: body.professional_registration || null,
          },
        ]);
        notify('Membro fictício adicionado. Nenhum convite foi enviado.');
      } else {
        await api('members', { method: 'POST', body: JSON.stringify(body) });
        const data = await api('members');
        setMembers(data.members);
        notify('Convite enviado por e-mail.');
      }
      setInvite(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!isAdmin)
    return (
      <Empty
        title="Acesso administrativo"
        description="A gestão da equipe está disponível para administradores da organização."
      />
    );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Profissionais da organização</h2>
          <p>Permissões específicas para cada responsabilidade</p>
        </div>
        <button className="button primary" onClick={() => setInvite(true)}>
          <Plus size={16} />
          Convidar profissional
        </button>
      </div>
      {error && !invite && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>PROFISSIONAL</th>
              <th>PERFIL</th>
              <th>REGISTRO</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>
                  <strong>{m.display_name}</strong>
                </td>
                <td>
                  {m.role === 'admin'
                    ? 'Administrador'
                    : m.role === 'physician'
                      ? 'Médico'
                      : 'Consulta'}
                </td>
                <td>{m.professional_registration || 'Não informado'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!members.length && (
        <Empty
          title="Nenhum profissional carregado"
          description="Entre com uma conta administrativa para consultar sua equipe."
        />
      )}
      {invite && (
        <Modal
          title="Convidar profissional"
          onClose={() => {
            if (!busy) setInvite(false);
          }}
        >
          <form onSubmit={submit}>
            <div className="modal-body">
              <label>
                Nome completo
                <input name="name" minLength={2} maxLength={160} required />
              </label>
              <label>
                E-mail
                <input name="email" type="email" required />
              </label>
              <div className="form-row">
                <label>
                  Perfil
                  <select name="role">
                    <option value="physician">Médico</option>
                    <option value="viewer">Apenas consulta</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
                <label>
                  Registro profissional
                  <input name="registration" maxLength={80} placeholder="CRM / UF / número" />
                </label>
              </div>
              <p className="muted">
                A aprovação exige registro profissional cadastrado. Confirme a identidade e a
                habilitação do profissional antes do convite.
              </p>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setInvite(false)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button className="button primary" disabled={busy}>
                {busy && <Loader2 className="spin" size={16} />}Enviar convite
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

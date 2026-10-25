'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { FlexibleApi } from '@/lib/api-types';
import { Empty } from './clinical-ui';
export default function Audit({
  demo,
  api,
  isAdmin,
}: {
  demo: boolean;
  api: FlexibleApi;
  isAdmin: boolean;
}) {
  const [events, setEvents] = useState<
      {
        id: number;
        action: string;
        created_at: string;
        actor_id: string | null;
        case_id: string | null;
      }[]
    >(
      demo
        ? [
            {
              id: 1,
              action: 'demo.workspace_viewed',
              created_at: new Date().toISOString(),
              actor_id: 'Usuário demonstrativo',
              case_id: null,
            },
          ]
        : [],
    ),
    [error, setError] = useState('');
  useEffect(() => {
    if (!demo && isAdmin)
      api('audit')
        .then((d) => setEvents(d.events))
        .catch((e) => setError(e.message));
  }, [demo, api, isAdmin]);
  if (!isAdmin)
    return (
      <Empty
        title="Acesso administrativo"
        description="A trilha de auditoria é restrita aos administradores da organização."
      />
    );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Trilha de auditoria</h2>
          <p>Até 100 eventos recentes · Horário de Brasília</p>
        </div>
        <ShieldCheck size={20} />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>EVENTO</th>
              <th>RESPONSÁVEL</th>
              <th>DATA E HORA</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>
                  <code>{e.action}</code>
                </td>
                <td className="mono">{e.actor_id || 'Integração via API'}</td>
                <td>
                  {new Date(e.created_at).toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!events.length && (
        <Empty
          title="Sem eventos para exibir"
          description="Ações realizadas na plataforma serão registradas neste painel."
        />
      )}
      <div className="table-footer">
        {demo
          ? 'Exemplo fictício de evento. O modo de demonstração não mantém uma trilha persistente.'
          : 'A trilha registra acessos e operações; o conteúdo clínico não é incluído nos logs do servidor.'}
      </div>
    </section>
  );
}

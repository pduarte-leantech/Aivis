'use client';
import { useState } from 'react';
import { Loader2, Plus, ShieldCheck } from 'lucide-react';
import type { ClinicalCase } from '@/lib/types';
import { getDemoCases } from '@/lib/demo';
import type { FlexibleApi } from '@/lib/api-types';
import { Modal } from './clinical-ui';
export default function NewCase({
  demo,
  api,
  onClose,
  onCreated,
  busy,
  setBusy,
}: {
  demo: boolean;
  api: FlexibleApi;
  onClose: () => void;
  onCreated: (c: ClinicalCase) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(e.currentTarget);
    const body = {
      patient_name: String(data.get('name')),
      patient_code: String(data.get('code')),
      birth_date: String(data.get('birth_date')) || null,
      anamnesis: String(data.get('anamnesis')),
    };
    try {
      if (demo) {
        onCreated({
          ...getDemoCases()[2],
          ...body,
          id: crypto.randomUUID(),
          exams: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          report: null,
          model: null,
          status: 'pending',
          revision: 1,
        });
      } else {
        const c = await api('cases', { method: 'POST', body: JSON.stringify(body) });
        onCreated({ ...c, exams: [] });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Novo caso clínico"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="muted">
            {demo
              ? 'Use apenas dados fictícios nesta demonstração.'
              : 'Informe o contexto necessário para uma análise responsável.'}
          </p>
          <div className="form-row">
            <label>
              Nome do paciente
              <input
                name="name"
                required
                minLength={2}
                maxLength={160}
                placeholder="Nome completo"
              />
            </label>
            <label>
              Identificador
              <input name="code" required maxLength={80} placeholder="Ex.: PAC-1049" />
            </label>
          </div>
          <label>
            Data de nascimento <span className="optional">Opcional</span>
            <input
              name="birth_date"
              type="date"
              min="1900-01-01"
              max={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label>
            Anamnese
            <textarea
              aria-label="Anamnese"
              aria-describedby="anamnesis-help"
              name="anamnesis"
              required
              minLength={30}
              maxLength={20000}
              rows={6}
              placeholder="Queixa principal, histórico, sintomas, medicações e contexto clínico relevante…"
            />
            <small id="anamnesis-help">
              Mínimo de 30 caracteres. Não inclua instruções para a IA.
            </small>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="inline-notice">
            <ShieldCheck size={19} />
            <span>O caso permanecerá em rascunho até a análise e a revisão do médico.</span>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}Criar caso
          </button>
        </div>
      </form>
    </Modal>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  CheckCheck,
  FileSearch,
  FileText,
  Fingerprint,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import type { ClinicalCase, Report } from '@/lib/types';
import { reportLabels } from '@/lib/types';
import { demoReport } from '@/lib/demo';
import type { FlexibleApi } from '@/lib/api-types';
import { Modal, Status, date } from './clinical-ui';
export default function Review({
  c,
  demo,
  canReview,
  api,
  onChange,
  onBack,
  notify,
}: {
  c: ClinicalCase;
  demo: boolean;
  canReview: boolean;
  api: FlexibleApi;
  onChange: (c: ClinicalCase) => void;
  onBack: () => void;
  notify: (s: string) => void;
}) {
  const [report, setReport] = useState<Report>(c.report || demoReport),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [pdfUrl, setPdfUrl] = useState(''),
    [pdfError, setPdfError] = useState(''),
    [confirm, setConfirm] = useState(false),
    [reject, setReject] = useState(false),
    [reason, setReason] = useState(''),
    [consent, setConsent] = useState(false),
    [view, setView] = useState<'edit' | 'pdf'>('edit');
  const dirty = JSON.stringify(report) !== JSON.stringify(c.report);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!c.report) return;
    let cancelled = false,
      url = '';
    const timer = setTimeout(async () => {
      setPdfError('');
      try {
        let blob: Blob;
        if (!demo && c.status === 'approved') {
          const res = await fetch(`/api/v1/cases/${c.id}/pdf`, {
            headers: { 'x-tenant-id': c.tenant_id },
          });
          if (!res.ok) throw new Error('Não foi possível carregar o documento final.');
          blob = await res.blob();
        } else {
          const [{ generatePdf }, { browserPdfFonts }] = await Promise.all([
            import('@/lib/pdf'),
            import('@/lib/pdf-fonts'),
          ]);
          const bytes = await generatePdf(
            { ...c, report },
            c.status === 'approved',
            demo,
            await browserPdfFonts(),
          );
          blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' });
        }
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (e) {
        if (!cancelled) setPdfError((e as Error).message);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [c, report, demo]);
  async function execute(action: string, body?: unknown) {
    setBusy(action);
    setError('');
    try {
      if (demo) {
        let next = { ...c, updated_at: new Date().toISOString(), revision: c.revision + 1 };
        if (action === 'analyze')
          next = {
            ...next,
            status: 'review',
            report: { ...demoReport },
            model: 'Demonstração · sem chamada à IA',
          };
        if (action === 'report') next = { ...next, report };
        if (action === 'approve')
          next = {
            ...next,
            status: 'approved',
            approved_at: new Date().toISOString(),
            approver_name: 'Médico demonstrativo',
            approver_registration: 'DEMO · sem validade',
          };
        if (action === 'reject') next = { ...next, status: 'rejected' };
        onChange(next);
        notify('Demonstração atualizada. Nenhum dado clínico real foi processado.');
      } else {
        const data = await api(`cases/${c.id}/${action}`, {
          method: action === 'report' ? 'PATCH' : 'POST',
          body: JSON.stringify(body || { revision: c.revision }),
        });
        if (action === 'report' && data.report) setReport(data.report);
        onChange({ ...c, ...data });
        notify(
          action === 'approve'
            ? 'Relatório aprovado e PDF armazenado.'
            : action === 'report'
              ? 'Nova versão salva.'
              : action === 'analyze'
                ? 'Análise concluída. Revise o rascunho.'
                : 'Relatório recusado.',
        );
      }
      setConfirm(false);
      setReject(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy('upload');
    setError('');
    try {
      const exams = [...(c.exams || [])];
      for (const file of Array.from(files)) {
        if (file.size > 4 * 1024 * 1024) throw new Error('Cada arquivo deve ter no máximo 4 MB.');
        if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw new Error('Envie PDF, PNG, JPEG ou WebP.');
        if (exams.length >= 8) throw new Error('Limite de 8 arquivos por caso.');
        if (demo)
          exams.push({
            id: crypto.randomUUID(),
            case_id: c.id,
            name: file.name,
            mime_type: file.type,
            size: file.size,
            storage_path: '',
            created_at: new Date().toISOString(),
          });
        else {
          const form = new FormData();
          form.set('file', file);
          const data = await api(`cases/${c.id}/upload`, { method: 'POST', body: form });
          exams.push({
            ...data,
            case_id: c.id,
            storage_path: '',
            created_at: new Date().toISOString(),
          });
        }
        onChange({ ...c, exams: [...exams] });
      }
      notify(
        demo
          ? 'Arquivos listados apenas nesta demonstração; conteúdo não enviado.'
          : 'Exames enviados com sucesso.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  async function viewExam(examId: string) {
    if (demo) {
      notify('Exame fictício. Não existe arquivo original nesta demonstração.');
      return;
    }
    try {
      const res = await fetch(`/api/v1/cases/${c.id}/exams?exam_id=${examId}`, {
        headers: { 'x-tenant-id': c.tenant_id },
      });
      if (!res.ok) throw new Error('Não foi possível abrir o exame.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = c.exams?.find((e) => e.id === examId)?.name || 'exame';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="review-page">
      <button
        className="back-button"
        onClick={() => {
          if (
            dirty &&
            c.report &&
            !window.confirm('Há alterações não salvas. Deseja sair sem salvar?')
          )
            return;
          onBack();
        }}
      >
        <ArrowLeft size={16} />
        Voltar para o workspace
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CASO / {c.patient_code}</div>
          <h1>{c.patient_name}</h1>
          <p>
            Criado em {date(c.created_at)} · Versão {c.revision}
            {demo ? ' · Dados fictícios' : ''}
          </p>
        </div>
        <Status status={c.status} />
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="case-context">
        <section className="panel">
          <div className="panel-heading">
            <h2>Contexto clínico</h2>
            <Fingerprint size={18} />
          </div>
          <p>{c.anamnesis}</p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              Exames do caso <span className="small-count">{c.exams?.length || 0}</span>
            </h2>
            {c.status === 'pending' && (
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={15} />
                Adicionar
              </button>
            )}
          </div>
          {c.exams?.length ? (
            <div className="exam-list">
              {c.exams.map((e) => (
                <button key={e.id} onClick={() => void viewExam(e.id)}>
                  <span className="file-icon">
                    <FileText size={18} />
                  </span>
                  <span>
                    <strong>{e.name}</strong>
                    <small>
                      {(e.size / 1024).toFixed(0)} KB · {e.mime_type.split('/')[1].toUpperCase()}
                    </small>
                  </span>
                  <ArrowDownToLine size={15} />
                </button>
              ))}
            </div>
          ) : (
            <button
              className="upload-zone"
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
            >
              <Upload size={24} />
              <strong>Adicione os exames</strong>
              <span>PDF com texto ou imagens · Até 4 MB por arquivo</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            aria-label="Enviar exames"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => void upload(e.target.files)}
          />
        </section>
      </div>
      {c.status === 'pending' ? (
        <section className="panel analyze-panel">
          <span className="large-icon">
            <Sparkles size={30} />
          </span>
          <h2>Pronto para organizar as evidências?</h2>
          <p>
            O Grok considera os exames e a anamnese para elaborar um rascunho clínico. O documento
            só será liberado após a revisão médica.
          </p>
          <div className="inline-notice">
            <FileText size={18} />
            <span>
              PDFs: somente texto extraível será analisado. Imagens dentro do PDF precisam ser
              enviadas separadamente.
            </span>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              {demo
                ? 'Entendo que esta análise é simulada, com dados fictícios.'
                : 'Confirmo a autorização para processar estes dados clínicos via xAI, conforme as políticas da organização.'}
            </span>
          </label>
          <button
            className="button primary"
            disabled={!!busy || !consent || !c.exams?.length}
            onClick={() => void execute('analyze', { consent: true })}
          >
            {busy === 'analyze' ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />}{' '}
            {demo ? 'Simular rascunho' : 'Analisar exames'}
          </button>
          {busy === 'analyze' && (
            <p role="status">A análise pode levar até dois minutos. Não feche esta página.</p>
          )}
        </section>
      ) : (
        <>
          <div className={`review-notice ${c.status === 'approved' ? 'approved-notice' : ''}`}>
            <ShieldCheck size={20} />
            <div>
              <strong>
                {c.status === 'approved'
                  ? 'Relatório aprovado e preservado'
                  : c.status === 'rejected'
                    ? 'Relatório recusado'
                    : 'Rascunho de apoio à decisão clínica'}
              </strong>
              <p>
                {c.status === 'approved'
                  ? `Revisado por ${c.approver_name} · ${c.approver_registration}. O documento final não pode ser editado.`
                  : c.status === 'rejected'
                    ? 'Este documento foi recusado e não está disponível como relatório final.'
                    : 'Confira os exames originais, ajuste o conteúdo e assuma a decisão antes de aprovar.'}
              </p>
            </div>
          </div>
          <div className="review-toolbar">
            <div className="segmented">
              <button className={view === 'edit' ? 'selected' : ''} onClick={() => setView('edit')}>
                <FileText size={15} />
                Conteúdo
              </button>
              <button className={view === 'pdf' ? 'selected' : ''} onClick={() => setView('pdf')}>
                <FileSearch size={15} />
                Visualizar PDF
              </button>
            </div>
            <div>
              {dirty && c.status === 'review' && (
                <span className="unsaved">Alterações não salvas</span>
              )}
              {c.status === 'review' && (
                <button
                  className="button secondary"
                  disabled={!!busy || !dirty || !canReview}
                  onClick={() => void execute('report', { revision: c.revision, report })}
                >
                  {busy === 'report' ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                  Salvar alterações
                </button>
              )}
              {pdfUrl && (
                <a
                  className="button secondary"
                  href={pdfUrl}
                  download={`aivis-${c.patient_code}${c.status === 'approved' ? '' : '-rascunho'}.pdf`}
                >
                  <ArrowDownToLine size={16} />
                  Baixar PDF
                </a>
              )}
            </div>
          </div>
          <div className={`report-layout ${view === 'pdf' ? 'pdf-focused' : ''}`}>
            <section className={`panel report-editor ${view === 'pdf' ? 'hide-mobile' : ''}`}>
              <div className="panel-heading">
                <div>
                  <h2>Relatório clínico</h2>
                  <p>
                    {c.model} · Versão {c.revision}
                  </p>
                </div>
                <span className="small-badge">
                  {c.status === 'approved' ? 'FINAL' : 'RASCUNHO'}
                </span>
              </div>
              <div className="report-fields">
                {Object.entries(reportLabels).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    {c.status === 'review' && canReview ? (
                      <textarea
                        rows={key === 'findings' ? 6 : 5}
                        maxLength={
                          key === 'findings'
                            ? 12000
                            : key === 'summary' || key === 'limitations'
                              ? 6000
                              : 8000
                        }
                        value={report[key as keyof Report]}
                        onChange={(e) => setReport({ ...report, [key]: e.target.value })}
                      />
                    ) : (
                      <p>{report[key as keyof Report]}</p>
                    )}
                  </label>
                ))}
              </div>
            </section>
            <section className={`panel pdf-panel ${view === 'edit' ? 'hide-mobile' : ''}`}>
              <div className="pdf-toolbar">
                <span>
                  <FileText size={15} />
                  Prévia do documento
                </span>
                <span>PDF · A4</span>
              </div>
              {pdfError ? (
                <div className="form-error" role="alert">
                  {pdfError}
                </div>
              ) : pdfUrl ? (
                <iframe
                  key={pdfUrl}
                  title="Prévia do relatório clínico em PDF"
                  src={`${pdfUrl}#toolbar=0&navpanes=0`}
                  className="pdf-frame"
                />
              ) : (
                <div className="loading">
                  <Loader2 className="spin" size={22} />
                  Gerando prévia…
                </div>
              )}
              <p className="pdf-caption">
                {dirty
                  ? 'A prévia inclui alterações ainda não salvas.'
                  : c.status === 'approved'
                    ? 'Documento final armazenado.'
                    : 'Documento em rascunho, sem liberação clínica.'}
              </p>
            </section>
          </div>
          {c.status === 'review' && (
            <div className="approval-bar">
              <div>
                <ShieldCheck size={21} />
                <span>
                  <strong>A decisão clínica é do médico.</strong>
                  <small>
                    {canReview
                      ? 'Revise todas as seções antes de aprovar.'
                      : 'Seu perfil não permite editar ou aprovar relatórios.'}
                  </small>
                </span>
              </div>
              <div>
                <button
                  className="button danger"
                  disabled={!!busy || !canReview}
                  onClick={() => setReject(true)}
                >
                  <XCircle size={16} />
                  Recusar
                </button>
                <button
                  className="button primary"
                  disabled={!!busy || dirty || !canReview}
                  onClick={() => setConfirm(true)}
                >
                  <CheckCheck size={17} />
                  Aprovar relatório
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {confirm && (
        <Modal
          title={demo ? 'Simular aprovação' : 'Aprovar relatório clínico'}
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <div className="modal-body">
            <div className="inline-notice">
              <ShieldCheck size={23} />
              <span>
                Ao aprovar, você confirma que revisou os exames originais e o conteúdo da versão{' '}
                {c.revision}. O PDF final será armazenado e ficará disponível na plataforma e via
                API.
              </span>
            </div>
            <p>
              O documento aprovado é imutável. A aprovação na plataforma não equivale a uma
              assinatura digital ICP-Brasil.
            </p>
            {demo && (
              <p className="form-error">
                Demonstração: o documento será marcado como fictício e sem validade clínica.
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => setConfirm(false)}
            >
              Voltar à revisão
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => void execute('approve', { revision: c.revision, confirmed: true })}
            >
              {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Confirmar
              aprovação
            </button>
          </div>
        </Modal>
      )}
      {reject && (
        <Modal
          title="Recusar relatório"
          onClose={() => {
            if (!busy) setReject(false);
          }}
        >
          <div className="modal-body">
            <p className="muted">
              O relatório será encerrado como recusado. Registre o motivo sem incluir
              identificadores de pacientes.
            </p>
            <label>
              Motivo da recusa
              <textarea
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={10}
                maxLength={1000}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setReject(false)} disabled={!!busy}>
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={!!busy || reason.trim().length < 10}
              onClick={() => void execute('reject', { revision: c.revision, reason })}
            >
              Confirmar recusa
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

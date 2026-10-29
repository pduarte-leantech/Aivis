'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Layers, Loader2 } from 'lucide-react';
import type { Exam } from '@/lib/types';
import { Modal } from './clinical-ui';
export default function DicomViewer({
  exam,
  caseId,
  tenantId,
  demo,
  onClose,
}: {
  exam: Exam;
  caseId: string;
  tenantId: string;
  demo: boolean;
  onClose: () => void;
}) {
  const [frame, setFrame] = useState(0),
    [windowIndex, setWindow] = useState(0),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const metadata = exam.metadata;
  const frames = metadata?.frames || 1,
    windows = metadata?.frame_windows[frame] || [];
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    let objectUrl = '';
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `/api/v1/cases/${caseId}/dicom?exam_id=${exam.id}&frame=${frame}&window=${windowIndex}`,
          { headers: { 'x-tenant-id': tenantId }, signal: controller.signal },
        );
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Não foi possível renderizar o frame.');
        }
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [exam.id, caseId, tenantId, frame, windowIndex, demo]);
  return (
    <Modal title={`Imagens DICOM · ${exam.name}`} onClose={onClose} wide>
      <div className="modal-body">
        <div className="dicom-info">
          <span>
            <Layers size={16} />
            {metadata?.modality || 'DICOM'} · {frames} frame(s)
          </span>
          {metadata && (
            <span>
              {metadata.width} × {metadata.height} · {metadata.bits_allocated} bits originais
            </span>
          )}
        </div>
        <div className="dicom-stage">
          {demo ? (
            <p>
              Na demonstração, somente o nome do arquivo é listado. A leitura de imagens reais
              requer o ambiente conectado; nenhuma imagem clínica fictícia é gerada.
            </p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : loading ? (
            <span role="status">
              <Loader2 size={24} className="spin" />
              Extraindo imagem DICOM…
            </span>
          ) : url ? (
            <Image
              src={url}
              alt={`Frame ${frame + 1} do exame DICOM, janela ${windowIndex + 1}`}
              width={metadata?.width || 1024}
              height={metadata?.height || 1024}
              unoptimized
            />
          ) : null}
        </div>
        <div className="dicom-controls">
          <div>
            <button
              className="icon-btn"
              aria-label="Frame anterior"
              disabled={frame === 0 || loading}
              onClick={() => {
                setFrame((f) => f - 1);
                setWindow(0);
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <label>
              Frame
              <select
                aria-label="Selecionar frame DICOM"
                value={frame}
                onChange={(e) => {
                  setFrame(Number(e.target.value));
                  setWindow(0);
                }}
              >
                {Array.from({ length: frames }, (_, i) => (
                  <option key={i} value={i}>
                    {i + 1} de {frames}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-btn"
              aria-label="Próximo frame"
              disabled={frame + 1 === frames || loading}
              onClick={() => {
                setFrame((f) => f + 1);
                setWindow(0);
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <label>
            Janela
            <select
              aria-label="Selecionar janela DICOM"
              value={windowIndex}
              onChange={(e) => setWindow(Number(e.target.value))}
            >
              {windows.length ? (
                windows.map((w, i) => (
                  <option key={i} value={i}>
                    {w.label} · C {w.center} / L {w.width}
                  </option>
                ))
              ) : (
                <option value={0}>
                  {metadata?.photometric.startsWith('MONOCHROME')
                    ? 'Automática (mín/máx)'
                    : 'Imagem colorida / padrão'}
                </option>
              )}
            </select>
          </label>
        </div>
        <div className="inline-notice">
          Prévia em PNG de 8 bits e até 1024 px. Não substitui o DICOM original nem um visualizador
          diagnóstico. Informações gravadas nos pixels podem continuar visíveis. A IA receberá todos
          os frames/janelas dentro dos limites de processamento, sem amostragem.
        </div>
      </div>
    </Modal>
  );
}

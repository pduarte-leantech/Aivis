import { describe, it, expect, vi, afterEach } from 'vitest';
import { caseSchema, reportSchema, isFileSignature, uploadSchema } from '../src/lib/validation';
import { generatePdf } from '../src/lib/pdf';
import { readFile } from 'node:fs/promises';
const fonts = {
  regular: await readFile('public/fonts/DejaVuSans.ttf'),
  bold: await readFile('public/fonts/DejaVuSans-Bold.ttf'),
};
import { getDemoCases, demoReport } from '../src/lib/demo';
import { getDocumentProxy, extractText } from 'unpdf';
import {
  checkOrigin,
  requirePhysician,
  requireAdmin,
  ApiError,
  type Access,
} from '../src/lib/auth';
import { analyzeWithGrok } from '../src/lib/grok';
describe('Clinical input boundaries', () => {
  it('rejects incomplete anamnesis, future dates and unexpected fields', () => {
    const base = {
      patient_name: 'Paciente Teste',
      patient_code: 'TEST-1',
      anamnesis: 'Anamnese fictícia com histórico suficiente para avaliação.',
    };
    expect(caseSchema.safeParse(base).success).toBe(true);
    expect(caseSchema.safeParse({ ...base, anamnesis: 'oi' }).success).toBe(false);
    expect(caseSchema.safeParse({ ...base, birth_date: '2099-01-01' }).success).toBe(false);
    expect(caseSchema.safeParse({ ...base, tenant_id: 'other' }).success).toBe(false);
  });
  it('requires every report section and limits each file to 4 MB', () => {
    expect(reportSchema.safeParse(demoReport).success).toBe(true);
    expect(reportSchema.safeParse({ ...demoReport, limitations: '' }).success).toBe(false);
    expect(
      uploadSchema.safeParse({
        name: 'scan.pdf',
        mime_type: 'application/pdf',
        size: 5 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });
  it('does not accept an extension or MIME claim instead of a valid signature', () => {
    expect(
      isFileSignature(new TextEncoder().encode('<script>attack</script>'), 'application/pdf'),
    ).toBe(false);
    expect(isFileSignature(new TextEncoder().encode('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(isFileSignature(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png')).toBe(
      true,
    );
    expect(isFileSignature(new Uint8Array([255, 216, 255]), 'image/jpeg')).toBe(true);
  });
});
describe('Medical approval and origin boundaries', () => {
  afterEach(() => vi.unstubAllEnvs());
  const base = {
    apiKeyId: null,
    membership: { role: 'physician', professional_registration: 'CRM-SP 1234' },
  } as Access;
  it('never allows an API key or an unregistered viewer to approve', () => {
    expect(() => requirePhysician({ ...base, apiKeyId: 'key' })).toThrow(ApiError);
    expect(() =>
      requirePhysician({ ...base, membership: { ...base.membership!, role: 'viewer' } }),
    ).toThrow(ApiError);
    expect(() =>
      requirePhysician({
        ...base,
        membership: { ...base.membership!, professional_registration: null },
      }),
    ).toThrow(ApiError);
    expect(() => requirePhysician(base)).not.toThrow();
  });
  it('restricts organization management to a human administrator', () => {
    expect(() => requireAdmin(base)).toThrow();
    expect(() =>
      requireAdmin({ ...base, membership: { ...base.membership!, role: 'admin' } }),
    ).not.toThrow();
    expect(() =>
      requireAdmin({
        ...base,
        apiKeyId: 'key',
        membership: { ...base.membership!, role: 'admin' },
      }),
    ).toThrow();
  });
  it('rejects missing and cross-site origins on cookie mutations', () => {
    vi.stubEnv('APP_URL', 'https://clinical.example');
    expect(() =>
      checkOrigin(
        new Request('https://clinical.example/api', {
          method: 'POST',
          headers: { origin: 'https://attacker.example' },
        }),
      ),
    ).toThrow();
    expect(() =>
      checkOrigin(new Request('https://clinical.example/api', { method: 'POST' })),
    ).toThrow();
    expect(() =>
      checkOrigin(
        new Request('https://clinical.example/api', {
          method: 'POST',
          headers: { origin: 'https://clinical.example' },
        }),
      ),
    ).not.toThrow();
  });
});
describe('PDF integrity and content', () => {
  it('renders an editable report into a multipage, clearly marked demo PDF', async () => {
    const c = {
      ...getDemoCases()[0],
      report: {
        ...demoReport,
        findings: 'Evidência fictícia e hipóteses que exigem revisão. '.repeat(100),
      },
    };
    const bytes = await generatePdf(c, false, true, fonts);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await getDocumentProxy(bytes);
    try {
      const result = await extractText(pdf, { mergePages: true });
      expect(pdf.numPages).toBeGreaterThan(1);
      expect(result.text).toContain('SEM VALIDADE CLÍNICA');
      expect(result.text).toContain('NÃO APROVADO');
      expect(result.text).toContain('Limitações e incertezas');
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
  it('includes approver identity and version on approved reports', async () => {
    const c = getDemoCases()[1];
    const pdf = await getDocumentProxy(await generatePdf(c, true, true, fonts));
    try {
      const { text } = await extractText(pdf, { mergePages: true });
      expect(text).toContain('Médico demonstrativo');
      expect(text).toContain('ICP-Brasil');
      expect(text).toContain('Versão: 3');
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
});
describe('AI execution safety', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('fails closed before sending data when AI processing is disabled', async () => {
    vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(analyzeWithGrok(getDemoCases()[0], [], {} as never)).rejects.toThrow(
      'não foi habilitado',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects malformed provider output and keeps the result a draft', async () => {
    vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
    vi.stubEnv('XAI_API_KEY', 'test-only-not-a-secret');
    const c = getDemoCases()[0];
    const db = {
      storage: {
        from: () => ({
          download: async () => ({
            data: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]),
            error: null,
          }),
        }),
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"summary":"unverified"}' } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      analyzeWithGrok(c, [{ ...c.exams![0], mime_type: 'image/png' }], db as never),
    ).rejects.toThrow('formato inválido');
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(demoReport) } }],
          usage: { prompt_tokens: 50 },
        }),
        { status: 200 },
      ),
    );
    const result = await analyzeWithGrok(
      c,
      [{ ...c.exams![0], mime_type: 'image/png' }],
      db as never,
    );
    expect(result.report).toEqual(demoReport);
    expect(result).not.toHaveProperty('approved_at');
    expect(result).not.toHaveProperty('status');
  });
});

it('preserves clinical inequality signs, Greek symbols and units without silent substitution', async () => {
  const c = getDemoCases()[0];
  c.report = { ...demoReport, findings: 'PCR ≥ 10 mg/L; TSH ≤ 0,1; β-hCG; 10 µg; ↑ ↓.' };
  const pdf = await getDocumentProxy(await generatePdf(c, false, true, fonts));
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain('PCR ≥ 10 mg/L');
    expect(text).toContain('TSH ≤ 0,1');
    expect(text).toContain('β-hCG');
    // PDF.js normalizes the micro sign to its Unicode-compatible Greek form.
    expect(text.normalize('NFKC')).toContain('µg'.normalize('NFKC'));
    expect(text).toContain('↑ ↓');
  } finally {
    await pdf.loadingTask.destroy();
  }
});

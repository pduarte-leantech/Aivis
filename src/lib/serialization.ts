import type { ClinicalCase } from './types';
/** Integrations can follow progress, but only receive physician-approved text. */
export function exposeCase(c: ClinicalCase, integration: boolean): ClinicalCase {
  return {
    ...c,
    report: integration && c.status !== 'approved' ? null : c.report,
    pdf_path: null,
    exams: c.exams?.map((e) => ({ ...e, storage_path: '' })),
  };
}

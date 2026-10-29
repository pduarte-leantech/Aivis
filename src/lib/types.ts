export type CaseStatus = 'pending' | 'review' | 'approved' | 'rejected';
export type Report = {
  summary: string;
  findings: string;
  hypotheses: string;
  limitations: string;
  recommendations: string;
};
export type ClinicalCase = {
  id: string;
  tenant_id: string;
  patient_name: string;
  patient_code: string;
  birth_date: string | null;
  anamnesis: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  report: Report | null;
  revision: number;
  model: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approver_name: string | null;
  approver_registration: string | null;
  pdf_path: string | null;
  pdf_sha256: string | null;
  exams?: Exam[];
};
export type Exam = {
  id: string;
  case_id: string;
  name: string;
  mime_type: string;
  size: number;
  storage_path: string;
  metadata?: import('./dicom').DicomMetadata | null;
  created_at: string;
};
export type Membership = {
  tenant_id: string;
  role: 'admin' | 'physician' | 'viewer';
  display_name: string;
  professional_registration: string | null;
  tenants: { name: string };
};
export const statusLabel: Record<CaseStatus, string> = {
  pending: 'Aguardando análise',
  review: 'Em revisão',
  approved: 'Aprovado',
  rejected: 'Recusado',
};
export const reportLabels: Record<keyof Report, string> = {
  summary: 'Síntese clínica',
  findings: 'Achados dos exames',
  hypotheses: 'Hipóteses diagnósticas',
  limitations: 'Limitações e incertezas',
  recommendations: 'Considerações e próximos passos',
};

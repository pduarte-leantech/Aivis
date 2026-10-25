import type { ClinicalCase, Report } from './types';
export const demoReport: Report = {
  summary:
    'Paciente fictício, 42 anos, com fadiga há três semanas. Este exemplo demonstra a estrutura de revisão e não representa uma avaliação médica real.',
  findings:
    'Hemograma fictício com hemoglobina de 10,8 g/dL e VCM de 74 fL. Ferritina fictícia de 9 ng/mL. Estes valores são dados sintéticos para demonstração da interface.',
  hypotheses:
    'Exemplo de hipótese para revisão: padrão laboratorial compatível com anemia microcítica. A etiologia não pode ser determinada apenas pelos dados apresentados.',
  limitations:
    'Todos os dados deste caso são fictícios. Não houve análise de exames pela IA. A interpretação exige história clínica completa, exame físico e validação do médico.',
  recommendations:
    'Demonstrar a correlação com a história clínica, revisão dos exames originais e documentação do raciocínio pelo médico. Nenhuma conduta ou prescrição deve ser baseada neste exemplo.',
};
const names = [
  'Marina A. (fictícia)',
  'Carlos R. (fictício)',
  'Helena M. (fictícia)',
  'Rafael S. (fictício)',
  'Beatriz L. (fictícia)',
  'João P. (fictício)',
  'Laura C. (fictícia)',
  'André F. (fictício)',
];
export function getDemoCases(): ClinicalCase[] {
  return names.map((name, i) => {
    const date = new Date();
    date.setDate(date.getDate() - i * 4);
    const status = (
      [
        'review',
        'approved',
        'pending',
        'review',
        'approved',
        'approved',
        'rejected',
        'approved',
      ] as const
    )[i];
    return {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      tenant_id: 'demo',
      patient_name: name,
      patient_code: `DEMO-${1048 - i}`,
      birth_date: '1984-03-12',
      anamnesis:
        'Paciente fictício com fadiga há três semanas, sem febre ou sinais de sangramento relatados. Histórico e exames são exclusivamente demonstrativos.',
      status,
      created_at: date.toISOString(),
      updated_at: date.toISOString(),
      report: status === 'pending' ? null : { ...demoReport },
      revision: status === 'approved' ? 3 : 2,
      model: status === 'pending' ? null : 'Demonstração · sem chamada à IA',
      approved_at: status === 'approved' ? date.toISOString() : null,
      approved_by: status === 'approved' ? 'demo' : null,
      approver_name: 'Médico demonstrativo',
      approver_registration: 'DEMO · sem validade',
      pdf_path: null,
      pdf_sha256: null,
      exams: Array.from({ length: (i % 3) + 1 }, (_, j) => ({
        id: `exam-${i}-${j}`,
        case_id: `demo-${i}`,
        name:
          j === 0
            ? 'Hemograma completo.pdf'
            : j === 1
              ? 'Perfil laboratorial.pdf'
              : 'Exame complementar.png',
        mime_type: j === 2 ? 'image/png' : 'application/pdf',
        size: 124000 + j * 85000,
        storage_path: '',
        created_at: date.toISOString(),
      })),
    };
  });
}

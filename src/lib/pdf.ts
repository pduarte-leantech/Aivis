import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PdfFonts } from './pdf-fonts';
import type { ClinicalCase, Report } from './types';
import { reportLabels } from './types';
const safe = (v: string) =>
  v
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
export class PdfContentError extends Error {
  constructor() {
    super(
      'O conteúdo inclui um caractere sem suporte na fonte do PDF. Revise os símbolos antes de exportar.',
    );
    this.name = 'PdfContentError';
  }
}
export async function generatePdf(
  c: ClinicalCase,
  approved: boolean,
  demonstration: boolean,
  fonts: PdfFonts,
) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const regularChars = new Set(regular.getCharacterSet()),
    boldChars = new Set(bold.getCharacterSet());
  const w = 595.28,
    h = 841.89,
    margin = 48,
    width = w - margin * 2;
  let page = doc.addPage([w, h]),
    y = h - 50;
  function newPage() {
    page = doc.addPage([w, h]);
    y = h - 50;
  }
  function line(t: string, size = 10, strong = false, color = rgb(0.16, 0.22, 0.25)) {
    const font = strong ? bold : regular;
    const clean = safe(t);
    const supported = strong ? boldChars : regularChars;
    for (const ch of clean) {
      if (ch !== '\n' && ch !== '\t' && !supported.has(ch.codePointAt(0)!))
        throw new PdfContentError();
    }
    const paragraphs = clean.split('\n');
    for (const paragraph of paragraphs) {
      let row = '';
      for (const rawWord of paragraph.split(/\s+/)) {
        // Split long identifiers so no user-controlled text can escape the page.
        let fragment = '';
        const words: string[] = [];
        for (const ch of rawWord) {
          if (font.widthOfTextAtSize(fragment + ch, size) > width) {
            words.push(fragment);
            fragment = '';
          }
          fragment += ch;
        }
        if (fragment) words.push(fragment);
        for (const word of words) {
          if (font.widthOfTextAtSize(row + ' ' + word, size) > width && row) {
            if (y < 65) newPage();
            page.drawText(row, { x: margin, y, size, font, color });
            y -= size * 1.55;
            row = '';
          }
          row += (row ? ' ' : '') + word;
        }
      }
      if (y < 65) newPage();
      page.drawText(row, { x: margin, y, size, font, color });
      y -= size * 1.55;
    }
  }
  line('AIVIS  /  DOCUMENTO CLÍNICO', 10, true, rgb(0.08, 0.38, 0.32));
  y -= 14;
  if (demonstration) {
    line('DEMONSTRAÇÃO - DADOS FICTÍCIOS - SEM VALIDADE CLÍNICA', 10, true, rgb(0.65, 0.3, 0.08));
    y -= 10;
  }
  line(approved ? 'Relatório revisado pelo médico' : 'Rascunho para revisão médica', 20, true);
  y -= 12;
  line(`Paciente: ${c.patient_name}  |  Identificador: ${c.patient_code}`);
  line(`Caso: ${c.id}  |  Versão: ${c.revision}`);
  line(
    `Emissão: ${new Date(c.approved_at || c.updated_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
  );
  if (!approved)
    line('NÃO APROVADO. Não utilizar para conduta clínica.', 10, true, rgb(0.65, 0.3, 0.08));
  y -= 16;
  for (const [key, label] of Object.entries(reportLabels)) {
    if (y < 110) newPage();
    line(label, 12, true);
    y -= 4;
    line(c.report?.[key as keyof Report] || 'Não informado.');
    y -= 16;
  }
  if (approved) {
    line(`Revisado por: ${c.approver_name} | Registro: ${c.approver_registration}`, 10, true);
    line('A aprovação registrada na plataforma não constitui assinatura digital ICP-Brasil.', 8);
  }
  line(
    'Apoio à decisão clínica. A interpretação e a responsabilidade pela conduta são do médico assistente.',
    8,
  );
  for (const [index, p] of doc.getPages().entries()) {
    p.drawText(
      safe(`Aivis | ${approved ? 'Revisado' : 'Rascunho'} | ${index + 1} / ${doc.getPageCount()}`),
      { x: margin, y: 28, size: 8, font: regular, color: rgb(0.4, 0.45, 0.48) },
    );
  }
  doc.setTitle('Aivis - Relatório clínico');
  doc.setCreator('Aivis');
  return doc.save();
}

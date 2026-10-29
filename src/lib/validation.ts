import { z } from 'zod';
import { DICOM_MIME, maxExamBytes } from './upload-policy';
export const reportSchema = z
  .object({
    summary: z.string().trim().min(10).max(6000),
    findings: z.string().trim().min(10).max(12000),
    hypotheses: z.string().trim().min(10).max(8000),
    limitations: z.string().trim().min(10).max(6000),
    recommendations: z.string().trim().min(10).max(8000),
  })
  .strict();
export const caseSchema = z
  .object({
    patient_name: z.string().trim().min(2).max(160),
    patient_code: z.string().trim().min(1).max(80),
    birth_date: z.iso
      .date()
      .refine(
        (d) => d >= '1900-01-01' && d <= new Date().toISOString().slice(0, 10),
        'Data de nascimento inválida',
      )
      .nullable()
      .optional(),
    anamnesis: z
      .string()
      .trim()
      .min(30, 'Descreva pelo menos 30 caracteres de anamnese')
      .max(20000),
  })
  .strict();
export const uploadSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    mime_type: z.enum([
      'application/dicom',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]),
    size: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.size > maxExamBytes(file.mime_type))
      ctx.addIssue({
        code: 'custom',
        path: ['size'],
        message:
          file.mime_type === DICOM_MIME
            ? 'DICOM deve ter até 50 MB.'
            : 'PDFs e imagens devem ter até 4 MB.',
      });
  });
export function isFileSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === DICOM_MIME)
    return bytes.length >= 132 && new TextDecoder().decode(bytes.subarray(128, 132)) === 'DICM';
  if (mime === 'application/pdf') return new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
  if (mime === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp')
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
    );
  return false;
}

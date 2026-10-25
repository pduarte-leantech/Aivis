import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatePdf } from './pdf';
import type { ClinicalCase } from './types';
let fonts: Promise<{ regular: Uint8Array; bold: Uint8Array }> | undefined;
export async function generateServerPdf(c: ClinicalCase, approved = false) {
  fonts ??= Promise.all(
    ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((name) =>
      readFile(join(process.cwd(), 'public', 'fonts', name)),
    ),
  ).then(([regular, bold]) => ({ regular, bold }));
  return generatePdf(c, approved, false, await fonts);
}

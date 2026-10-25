export type PdfFonts = { regular: Uint8Array; bold: Uint8Array };
let cached: Promise<PdfFonts> | undefined;
export function browserPdfFonts() {
  cached ??= Promise.all(
    ['/fonts/DejaVuSans.ttf', '/fonts/DejaVuSans-Bold.ttf'].map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Não foi possível carregar as fontes do PDF.');
      return new Uint8Array(await response.arrayBuffer());
    }),
  )
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((error) => {
      cached = undefined;
      throw error;
    });
  return cached;
}

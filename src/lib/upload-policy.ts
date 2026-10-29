/** Shared policy; DICOM is normalized because browsers commonly send no MIME. */
export const DICOM_MIME = 'application/dicom';
export const MAX_DICOM_BYTES = 50 * 1024 * 1024;
export const MAX_STANDARD_BYTES = 4 * 1024 * 1024;
export const MAX_CASE_BYTES = 256 * 1024 * 1024;
export const MAX_EXAMS = 64;
export const MAX_ANALYSIS_IMAGES = 64;
export const ACCEPTED_EXAMS =
  '.dicom,.dcm,application/dicom,application/pdf,image/png,image/jpeg,image/webp';
export function normalizeExamMime(name: string, mime: string) {
  if (/\.(dicom|dcm)$/i.test(name) || mime.split(';')[0].trim().toLowerCase() === DICOM_MIME)
    return DICOM_MIME;
  const type = mime.split(';')[0].trim().toLowerCase();
  if (!type || type === 'application/octet-stream') {
    const ext = name.split('.').pop()?.toLowerCase();
    return (
      (
        {
          pdf: 'application/pdf',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
        } as Record<string, string>
      )[ext || ''] || type
    );
  }
  return type;
}
export function maxExamBytes(mime: string) {
  return mime === DICOM_MIME ? MAX_DICOM_BYTES : MAX_STANDARD_BYTES;
}

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ApiError } from './auth';
import { MAX_DICOM_BYTES } from './upload-policy';
export type DicomWindow = { center: number; width: number; function: string; label: string };
export type DicomMetadata = {
  format: 'DICOM';
  transfer_syntax: string;
  sop_class: string | null;
  modality: string;
  width: number;
  height: number;
  frames: number;
  bits_allocated: number;
  bits_stored: number;
  pixel_representation: number;
  photometric: string;
  render_invert: boolean;
  samples_per_pixel: number;
  pixel_spacing: number[] | null;
  image_orientation: number[] | null;
  frame_windows: DicomWindow[][];
  frame_rescale: { slope: number; intercept: number; inversion_axis: number }[];
  extracted_images: number;
  burned_in_annotation: string;
  rendering: string;
};
export type DicomImage = {
  frame: number;
  window: number;
  automatic_window: boolean;
  width: number;
  height: number;
  png: Uint8Array;
};
export async function processDicom(
  bytes: Uint8Array,
  options: {
    mode?: 'inspect' | 'render';
    frame?: number;
    window?: number;
    timeoutMs?: number;
  } = {},
): Promise<{ metadata: DicomMetadata; images: DicomImage[] }> {
  if (bytes.length > MAX_DICOM_BYTES) throw new ApiError(413, 'DICOM deve ter no máximo 50 MB.');
  const directory = await mkdtemp(join(tmpdir(), 'aivis-dicom-'));
  const buffer = Uint8Array.from(bytes).buffer;
  return new Promise<{ metadata: DicomMetadata; images: DicomImage[] }>((resolve, reject) => {
    const worker = new Worker(join(process.cwd(), 'scripts', 'dicom-worker.mjs'), {
      workerData: { buffer, directory, ...options },
      transferList: [buffer],
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    // Decoder output can contain patient information. Drain without logging/retaining it.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const timer = setTimeout(
      () => {
        if (!settled) {
          settled = true;
          void worker
            .terminate()
            .finally(() =>
              reject(
                new ApiError(
                  422,
                  'A leitura DICOM excedeu 45 segundos. Nenhum frame foi analisado.',
                ),
              ),
            );
        }
      },
      Math.min(45000, Math.max(1, options.timeoutMs ?? 45000)),
    );
    function fail() {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        void worker
          .terminate()
          .finally(() =>
            reject(
              new ApiError(
                422,
                'O decodificador DICOM não conseguiu processar este arquivo dentro dos limites de recursos.',
              ),
            ),
          );
      }
    }
    worker.once('error', fail);
    worker.once('exit', () => {
      if (!settled) fail();
    });
    worker.once('message', (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // All pixel work has finished; the parent removes its directory in finally.
      if (message.error) {
        reject(new ApiError(422, message.error));
        return;
      }
      resolve({
        metadata: message.metadata,
        images: message.images.map((i: Omit<DicomImage, 'png'> & { png: ArrayBuffer }) => ({
          ...i,
          png: new Uint8Array(i.png),
        })),
      });
    });
  }).finally(() => rm(directory, { recursive: true, force: true }));
}

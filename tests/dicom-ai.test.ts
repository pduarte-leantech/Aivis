import { it, expect, vi, afterEach } from 'vitest';
import { analyzeWithGrok } from '../src/lib/grok';
import { makeDicom } from './fixtures/dicom';
import { getDemoCases, demoReport } from '../src/lib/demo';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function setup(frames: number) {
  vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
  vi.stubEnv('XAI_API_KEY', 'test-only');
  const bytes = makeDicom({ frames });
  const db = {
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([new Uint8Array(bytes)]), error: null }),
      }),
    },
  };
  const provider = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(demoReport) } }] }),
          { status: 200 },
        ),
    );
  vi.stubGlobal('fetch', provider);
  return { db, provider };
}
it('sends real PNGs from every DICOM frame, not raw DICOM bytes or patient tags', async () => {
  const { db, provider } = setup(2),
    c = getDemoCases()[0];
  const result = await analyzeWithGrok(
    c,
    [{ ...c.exams![0], mime_type: 'application/dicom' }],
    db as never,
  );
  expect(provider).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(provider.mock.calls[0][1].body);
  const content = payload.messages[1].content;
  const images = content.filter((p: { type: string }) => p.type === 'image_url');
  expect(images).toHaveLength(2);
  for (const image of images) {
    expect(image.image_url.url).toMatch(/^data:image\/png;base64,/);
    const bytes = Buffer.from(image.image_url.url.split(',')[1], 'base64');
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  expect(JSON.stringify(content)).not.toMatch(
    /Synthetic\^Patient|FAKE-ONLY|data:application\/dicom/,
  );
  expect(result.dicomExtractions).toEqual([
    { exam_id: c.exams![0].id, frames: 2, images: 2, automatic_windows: true },
  ]);
  expect(result.report.limitations).toContain('2 frames');
  expect(result.report.limitations).toContain('8 bits');
});
it('rejects a case over the image budget before making any provider request', async () => {
  const { db, provider } = setup(33),
    c = getDemoCases()[0];
  await expect(
    analyzeWithGrok(
      c,
      [
        { ...c.exams![0], mime_type: 'application/dicom' },
        { ...c.exams![0], id: 'second', mime_type: 'application/dicom' },
      ],
      db as never,
    ),
  ).rejects.toMatchObject({ status: 422 });
  expect(provider).not.toHaveBeenCalled();
});

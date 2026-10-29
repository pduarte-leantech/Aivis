import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { processDicom } from '../src/lib/dicom';
import { makeDicom } from './fixtures/dicom';
import { normalizeExamMime } from '../src/lib/upload-policy';
import { uploadSchema, isFileSignature } from '../src/lib/validation';
async function gray(png: Uint8Array) {
  return Array.from(await sharp(png).removeAlpha().greyscale().raw().toBuffer());
}
describe('DICOM ingestion and real ITK/GDCM extraction', () => {
  it('normalizes .dicom/.dcm sent without MIME and accepts a larger DICOM only', () => {
    expect(normalizeExamMime('EXAM.DICOM', '')).toBe('application/dicom');
    expect(normalizeExamMime('exam.dcm', 'application/octet-stream')).toBe('application/dicom');
    expect(
      uploadSchema.safeParse({
        name: 'exam.dicom',
        mime_type: 'application/dicom',
        size: 40 * 1024 * 1024,
      }).success,
    ).toBe(true);
    expect(
      uploadSchema.safeParse({ name: 'exam.png', mime_type: 'image/png', size: 40 * 1024 * 1024 })
        .success,
    ).toBe(false);
    expect(isFileSignature(makeDicom(), 'application/dicom')).toBe(true);
  });
  it('inspects technical metadata without retaining patient tags', async () => {
    const result = await processDicom(makeDicom(), { mode: 'inspect' });
    expect(result.metadata).toMatchObject({
      format: 'DICOM',
      width: 2,
      height: 2,
      frames: 1,
      photometric: 'MONOCHROME2',
    });
    expect(JSON.stringify(result.metadata)).not.toMatch(/Synthetic|FAKE-ONLY|PatientName/);
    expect(result.images).toEqual([]);
  });
  it.each(['1.2.840.10008.1.2.1', '1.2.840.10008.1.2', '1.2.840.10008.1.2.2'])(
    'decodes native transfer syntax %s into an actual PNG',
    async (syntax) => {
      const result = await processDicom(makeDicom({ syntax }));
      expect(result.images).toHaveLength(1);
      expect(result.images[0]).toMatchObject({
        frame: 0,
        width: 2,
        height: 2,
        automatic_window: true,
      });
      expect(await gray(result.images[0].png)).toEqual([0, 85, 170, 255]);
    },
  );
  it('extracts every multiframe image, with no hidden sampling', async () => {
    const result = await processDicom(
      makeDicom({ frames: 2, values: [0, 100, 200, 300, 300, 200, 100, 0] }),
    );
    expect(result.metadata.frames).toBe(2);
    expect(result.images).toHaveLength(2);
    expect(await gray(result.images[1].png)).toEqual([255, 170, 85, 0]);
  });
  it('applies rescale once, DICOM windowing and MONOCHROME1 inversion', async () => {
    const opts = {
      values: [0, 100, 200, 300],
      slope: 2,
      intercept: -100,
      center: 200,
      widthWindow: 601,
    };
    const normal = await processDicom(makeDicom(opts));
    expect(await gray(normal.images[0].png)).toEqual([0, 85, 170, 255]);
    const inverted = await processDicom(makeDicom({ ...opts, photometric: 'MONOCHROME1' }));
    expect(await gray(inverted.images[0].png)).toEqual([255, 170, 85, 0]);
  });
  it('preserves signed 16-bit intensities before windowing', async () => {
    const result = await processDicom(
      makeDicom({ signed: true, values: [-1000, -500, 0, 500], center: -249.5, widthWindow: 1501 }),
    );
    expect(await gray(result.images[0].png)).toEqual([0, 85, 170, 255]);
  });
  it('extracts RGB pixel data without grayscale conversion', async () => {
    const result = await processDicom(
      makeDicom({ bits: 8, samples: 3, values: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255] }),
    );
    const { data, info } = await sharp(result.images[0].png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect(Array.from(data)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  });
  it('decodes real encapsulated JPEG baseline via GDCM', async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 180, g: 60, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const result = await processDicom(
      makeDicom({
        width: 8,
        height: 8,
        bits: 8,
        samples: 3,
        photometric: 'YBR_FULL_422',
        syntax: '1.2.840.10008.1.2.4.50',
        compressed: jpeg,
      }),
    );
    const { data } = await sharp(result.images[0].png).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(170);
    expect(data[1]).toBeLessThan(70);
    expect(data[2]).toBeLessThan(40);
  });
  it('decodes encapsulated RLE lossless', async () => {
    const header = Buffer.alloc(64);
    header.writeUInt32LE(1, 0);
    header.writeUInt32LE(64, 4);
    const rle = Buffer.concat([header, Buffer.from([3, 0, 85, 170, 255, 0])]);
    const result = await processDicom(
      makeDicom({ bits: 8, syntax: '1.2.840.10008.1.2.5', compressed: rle }),
    );
    expect(await gray(result.images[0].png)).toEqual([0, 85, 170, 255]);
  });
  it('refuses a fake signature, non-image DICOM, unsupported syntax and excessive frames', async () => {
    await expect(processDicom(new TextEncoder().encode('fake'))).rejects.toMatchObject({
      status: 422,
    });
    await expect(processDicom(makeDicom({ noPixels: true }))).rejects.toThrow('Pixel Data');
    await expect(processDicom(makeDicom({ frames: 65 }))).rejects.toThrow('limites');
    await expect(processDicom(makeDicom({ syntax: '1.2.840.10008.1.2.4.100' }))).rejects.toThrow(
      'não suportada',
    );
  });
  it('can render one requested frame and rejects nonexistent indices', async () => {
    const input = makeDicom({ frames: 2 });
    const result = await processDicom(input, { frame: 1, window: 0 });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].frame).toBe(1);
    await expect(processDicom(input, { frame: 2 })).rejects.toThrow('inexistente');
  });
});

it('extracts every declared window for each frame', async () => {
  const result = await processDicom(makeDicom({ center: [150.5, 50.5], widthWindow: [301, 101] }));
  expect(result.images).toHaveLength(2);
  expect(result.metadata.extracted_images).toBe(2);
  expect(result.images.map((i) => i.window)).toEqual([0, 1]);
  expect(await gray(result.images[0].png)).toEqual([0, 85, 170, 255]);
  expect(await gray(result.images[1].png)).toEqual([0, 255, 255, 255]);
});
it('handles LINEAR_EXACT and SIGMOID VOI functions', async () => {
  const values = [0, 50, 100, 150];
  let result = await processDicom(
    makeDicom({ values, center: 75, widthWindow: 150, voiFunction: 'LINEAR_EXACT' }),
  );
  expect(await gray(result.images[0].png)).toEqual([0, 85, 170, 255]);
  result = await processDicom(
    makeDicom({ values, center: 75, widthWindow: 50, voiFunction: 'SIGMOID' }),
  );
  expect(await gray(result.images[0].png)).toEqual([1, 30, 225, 254]);
});
it('respects explicit presentation inversion and rejects unknown LUT shapes', async () => {
  const result = await processDicom(makeDicom({ presentationShape: 'INVERSE' }));
  expect(await gray(result.images[0].png)).toEqual([255, 170, 85, 0]);
  await expect(processDicom(makeDicom({ presentationShape: 'UNKNOWN' }))).rejects.toThrow(
    'Presentation LUT',
  );
});
it('refuses malformed compressed pixel data rather than creating a substitute image', async () => {
  await expect(
    processDicom(
      makeDicom({ bits: 8, syntax: '1.2.840.10008.1.2.4.50', compressed: Buffer.from('not-jpeg') }),
    ),
  ).rejects.toMatchObject({ status: 422 });
});

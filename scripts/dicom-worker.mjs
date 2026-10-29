/** Isolated DICOM decoder. No source filenames, patient tags or codec logs escape this worker. */
import { parentPort, workerData } from 'node:worker_threads';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import dicomParser from 'dicom-parser';
import sharp from 'sharp';

const LIMITS = {
  frames: 64,
  dimension: 8192,
  samples: 32 * 1024 * 1024,
  views: 3,
  pngBytes: 4 * 1024 * 1024,
  totalPngBytes: 20 * 1024 * 1024,
};
const SYNTAXES = new Set([
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
  '1.2.840.10008.1.2.2',
  '1.2.840.10008.1.2.5',
  '1.2.840.10008.1.2.4.50',
  '1.2.840.10008.1.2.4.51',
  '1.2.840.10008.1.2.4.57',
  '1.2.840.10008.1.2.4.70',
  '1.2.840.10008.1.2.4.80',
  '1.2.840.10008.1.2.4.81',
  '1.2.840.10008.1.2.4.90',
  '1.2.840.10008.1.2.4.91',
]);
function invalid(message) {
  throw Object.assign(new Error(message), { safe: true });
}
function sequence(ds, tag) {
  return ds?.elements[tag]?.items?.[0]?.dataSet;
}
function windows(ds, frame) {
  const perFrame = ds.elements.x52009230?.items?.[frame]?.dataSet;
  const shared = sequence(ds, 'x52009229');
  const voi = sequence(perFrame, 'x00289132') || sequence(shared, 'x00289132') || ds;
  if (voi.elements.x00283010 || ds.elements.x00283010 || ds.elements.x00283000)
    invalid(
      'DICOM com LUT de apresentação/modalidade ainda não suportada. Nenhuma imagem foi omitida ou analisada.',
    );
  const count = voi.numStringValues('x00281051') || 0;
  if (count > LIMITS.views)
    invalid('DICOM com mais de três janelas por frame excede o limite de extração.');
  if (count !== (voi.numStringValues('x00281050') || 0))
    invalid('DICOM com centro/largura de janela incompletos.');
  const fn = voi.string('x00281056')?.trim() || 'LINEAR';
  if (!['LINEAR', 'LINEAR_EXACT', 'SIGMOID'].includes(fn))
    invalid('Função de janela DICOM não suportada.');
  return Array.from({ length: count }, (_, i) => {
    const center = voi.floatString('x00281050', i),
      width = voi.floatString('x00281051', i);
    if (
      !Number.isFinite(center) ||
      !Number.isFinite(width) ||
      width < (fn === 'LINEAR' ? 1 : Number.EPSILON)
    )
      invalid('DICOM com janelamento inválido.');
    return { center, width, function: fn, label: `Janela ${i + 1}` };
  });
}

function rescale(ds, frame, bits, signed) {
  const per = ds.elements.x52009230?.items?.[frame]?.dataSet,
    shared = sequence(ds, 'x52009229');
  const transform = sequence(per, 'x00289145') || sequence(shared, 'x00289145') || ds;
  const slope = transform.floatString('x00281053') ?? 1,
    intercept = transform.floatString('x00281052') ?? 0;
  const inversionAxis = (signed ? -1 : 2 ** bits - 1) * slope + 2 * intercept;
  if (
    !Number.isFinite(slope) ||
    slope === 0 ||
    !Number.isFinite(intercept) ||
    !Number.isFinite(inversionAxis)
  )
    invalid('Transformação de intensidade DICOM inválida.');
  return { slope, intercept, inversion_axis: inversionAxis };
}

function numbers(ds, tag, count) {
  const out = Array.from({ length: count }, (_, i) => ds.floatString(tag, i));
  return out.every(Number.isFinite) ? out : undefined;
}
function inspect(bytes) {
  if (bytes.length < 132 || Buffer.from(bytes.subarray(128, 132)).toString('ascii') !== 'DICM')
    invalid('Envie um arquivo DICOM Part 10 válido (.dicom ou .dcm), com cabeçalho DICM.');
  // Never inflate a user-controlled deflated dataset before resource validation.
  const ds = dicomParser.parseDicom(bytes, {
    untilTag: 'x7fe00010',
    inflater: () => invalid('Transferência DICOM Deflated ainda não suportada.'),
  });
  const syntax = ds.string('x00020010')?.trim();
  if (!SYNTAXES.has(syntax))
    invalid(
      'Sintaxe de transferência DICOM não suportada. Suporte: nativo, RLE, JPEG, JPEG Lossless, JPEG-LS e JPEG 2000.',
    );
  const width = ds.uint16('x00280011'),
    height = ds.uint16('x00280010'),
    samples = ds.uint16('x00280002'),
    bits = ds.uint16('x00280100'),
    stored = ds.uint16('x00280101'),
    representation = ds.uint16('x00280103');
  const frameString = ds.string('x00280008');
  if (frameString && !/^\d+$/.test(frameString.trim()))
    invalid('Contagem de frames DICOM inválida.');
  const frames = frameString ? Number(frameString) : 1;
  if (!ds.elements.x7fe00010)
    invalid(
      'O DICOM não contém imagens Pixel Data. DICOM SR, PDF encapsulado e DICOMDIR não são exames de imagem suportados.',
    );
  if (
    !width ||
    !height ||
    width > LIMITS.dimension ||
    height > LIMITS.dimension ||
    !Number.isInteger(frames) ||
    frames < 1 ||
    frames > LIMITS.frames ||
    ![1, 3].includes(samples) ||
    ![8, 16, 32].includes(bits) ||
    !stored ||
    stored > bits ||
    ![0, 1].includes(representation) ||
    width * height * frames * samples > LIMITS.samples
  )
    invalid(
      'DICOM excede os limites de decodificação: até 64 frames e 32 milhões de amostras, com pixels inteiros de 8, 16 ou 32 bits.',
    );
  const photometric = ds.string('x00280004')?.trim();
  if (
    !['MONOCHROME1', 'MONOCHROME2', 'RGB', 'YBR_FULL', 'YBR_FULL_422', 'PALETTE COLOR'].includes(
      photometric,
    )
  )
    invalid('Interpretação fotométrica DICOM não suportada.');
  const shape = ds.string('x20500020')?.trim();
  if (ds.elements.x20500010 || (shape && !['IDENTITY', 'INVERSE'].includes(shape)))
    invalid('Presentation LUT DICOM não suportada.');
  const monochrome = photometric.startsWith('MONOCHROME');
  if (monochrome && samples !== 1)
    invalid('Número de canais incompatível com DICOM monocromático.');
  const frameWindows = Array.from({ length: frames }, (_, i) => (monochrome ? windows(ds, i) : []));
  const pixelSpacing = numbers(ds, 'x00280030', 2);
  if (
    pixelSpacing &&
    (!pixelSpacing.every((n) => n > 0) ||
      Math.max(...pixelSpacing) / Math.min(...pixelSpacing) > 64)
  )
    invalid('Espaçamento físico dos pixels DICOM inválido.');
  const viewCount = frameWindows.reduce((n, w) => n + Math.max(1, w.length), 0);
  if (viewCount > 64)
    invalid(
      'O DICOM exige mais de 64 imagens considerando todos os frames e janelas. A extração foi recusada por inteiro; não há amostragem de frames.',
    );
  const metadata = {
    format: 'DICOM',
    transfer_syntax: syntax,
    sop_class: ds.string('x00080016')?.trim() || null,
    modality: ds.string('x00080060')?.trim() || 'OT',
    width,
    height,
    frames,
    bits_allocated: bits,
    bits_stored: stored,
    pixel_representation: representation,
    photometric,
    render_invert: shape ? shape === 'INVERSE' : photometric === 'MONOCHROME1',
    samples_per_pixel: samples,
    pixel_spacing: pixelSpacing || null,
    image_orientation: numbers(ds, 'x00200037', 6) || null,
    frame_windows: frameWindows,
    frame_rescale: Array.from({ length: frames }, (_, i) =>
      rescale(ds, i, stored, representation === 1),
    ),
    extracted_images: viewCount,
    burned_in_annotation: ds.string('x00280301')?.trim() || 'UNKNOWN',
    rendering:
      'PNG 8 bits, até 1024 px, sem overlays; rescale pelo GDCM; janela DICOM ou min/max. Prévia para apoio, não visualizador diagnóstico.',
  };
  return metadata;
}
function intensity(value, window, min, max, invert) {
  let v;
  if (!window) v = max === min ? 0 : (value - min) / (max - min);
  else if (window.function === 'SIGMOID')
    v = 1 / (1 + Math.exp((-4 * (value - window.center)) / window.width));
  else if (window.function === 'LINEAR_EXACT') v = (value - window.center) / window.width + 0.5;
  else if (window.width === 1) v = value <= window.center - 0.5 ? 0 : 1;
  else v = (value - (window.center - 0.5)) / (window.width - 1) + 0.5;
  v = Math.max(0, Math.min(1, v));
  return Math.round((invert ? 1 - v : v) * 255);
}

try {
  const bytes = new Uint8Array(workerData.buffer);
  const metadata = inspect(bytes);
  if (workerData.mode === 'inspect') {
    parentPort.postMessage({ metadata, images: [] });
  } else {
    // Load only the pipeline we use. stdout/stderr are captured by the parent and never logged.
    const { readImageDicomFileSeriesNode } = await import('@itk-wasm/dicom');
    const temp = workerData.directory;
    const source = join(temp, 'source.dcm');
    await writeFile(source, bytes, { mode: 0o600 });
    const { outputImage: image } = await readImageDicomFileSeriesNode({
      inputImages: [source],
      singleSortedSeries: true,
    });
    const channels = image.imageType.components;
    const colorMaximum =
      metadata.photometric === 'PALETTE COLOR'
        ? image.imageType.componentType === 'uint16'
          ? 65535
          : image.imageType.componentType === 'uint32'
            ? 4294967295
            : 255
        : 2 ** metadata.bits_stored - 1;
    const expectedChannels = metadata.photometric.startsWith('MONOCHROME') ? 1 : 3;
    const frameSize = metadata.width * metadata.height * channels;
    if (
      channels !== expectedChannels ||
      image.size[0] !== metadata.width ||
      image.size[1] !== metadata.height ||
      image.data.length !== frameSize * metadata.frames
    )
      invalid('Os pixels decodificados não correspondem às dimensões/canais declarados no DICOM.');
    // ITK/GDCM has already applied rescale slope/intercept. Never apply them a second time.
    const valueAt = (index) =>
      metadata.photometric === 'MONOCHROME1'
        ? metadata.frame_rescale[Math.floor(index / frameSize)].inversion_axis - image.data[index]
        : image.data[index];
    let min = Infinity,
      max = -Infinity;
    if (channels === 1) {
      for (let i = 0; i < image.data.length; i++) {
        const v = valueAt(i);
        if (!Number.isFinite(v)) invalid('DICOM contém intensidades não finitas.');
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    const requested = workerData.frame;
    if (
      requested !== undefined &&
      (!Number.isInteger(requested) || requested < 0 || requested >= metadata.frames)
    )
      invalid('Frame DICOM inexistente.');
    const frames =
      requested === undefined ? Array.from({ length: metadata.frames }, (_, i) => i) : [requested];
    const images = [];
    let total = 0;
    for (const frame of frames) {
      const windows = metadata.frame_windows[frame].length ? metadata.frame_windows[frame] : [null];
      const view = workerData.window;
      if (view !== undefined && (!Number.isInteger(view) || view < 0 || view >= windows.length))
        invalid('Janela DICOM inexistente.');
      for (const windowIndex of view === undefined ? windows.map((_, i) => i) : [view]) {
        const raw = new Uint8Array(frameSize),
          offset = frame * frameSize;
        for (let i = 0; i < frameSize; i++)
          raw[i] =
            channels === 1
              ? intensity(
                  valueAt(offset + i),
                  windows[windowIndex],
                  min,
                  max,
                  metadata.render_invert,
                )
              : Math.round(Math.max(0, Math.min(1, image.data[offset + i] / colorMaximum)) * 255);
        const spacing = metadata.pixel_spacing || [1, 1],
          ratio = (metadata.width * spacing[1]) / (metadata.height * spacing[0]);
        const outputWidth =
          ratio >= 1
            ? Math.min(1024, metadata.width)
            : Math.max(1, Math.round(Math.min(1024, metadata.height) * ratio));
        const outputHeight =
          ratio >= 1
            ? Math.max(1, Math.round(outputWidth / ratio))
            : Math.min(1024, metadata.height);
        const png = await sharp(raw, {
          raw: { width: metadata.width, height: metadata.height, channels },
        })
          .resize(outputWidth, outputHeight, { fit: 'fill' })
          .png({ compressionLevel: 6 })
          .toBuffer();
        total += png.length;
        if (png.length > LIMITS.pngBytes || total > LIMITS.totalPngBytes)
          invalid(
            'As imagens DICOM excedem o orçamento de 20 MB por extração. Nenhum frame será omitido.',
          );
        const buffer = Uint8Array.from(png).buffer;
        images.push({
          frame,
          window: windowIndex,
          automatic_window: windows[windowIndex] === null && channels === 1,
          width: outputWidth,
          height: outputHeight,
          png: buffer,
        });
      }
    }
    parentPort.postMessage(
      { metadata, images },
      images.map((i) => i.png),
    );
  }
} catch (error) {
  parentPort.postMessage({
    error: error.safe
      ? error.message
      : 'Não foi possível decodificar este DICOM. Arquivo inválido, truncado, não suportado ou sem imagem legível.',
  });
} finally {
  parentPort.close();
}

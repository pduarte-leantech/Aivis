/** Entirely synthetic DICOM Part 10 fixtures. No patient records. */
function element(
  group: number,
  tag: number,
  vr: string,
  value: Buffer,
  little = true,
  implicit = false,
) {
  const v = value.length % 2 ? Buffer.concat([value, Buffer.from([vr === 'UI' ? 0 : 32])]) : value;
  const long = ['OB', 'OW', 'OF', 'SQ', 'UN', 'UT'].includes(vr);
  const header = Buffer.alloc(implicit ? 8 : long ? 12 : 8);
  const u16 = little ? header.writeUInt16LE.bind(header) : header.writeUInt16BE.bind(header);
  const u32 = little ? header.writeUInt32LE.bind(header) : header.writeUInt32BE.bind(header);
  u16(group, 0);
  u16(tag, 2);
  if (implicit) u32(v.length, 4);
  else {
    header.write(vr, 4, 'ascii');
    if (long) u32(v.length, 8);
    else u16(v.length, 6);
  }
  return Buffer.concat([header, v]);
}
export function makeDicom(
  options: {
    width?: number;
    height?: number;
    frames?: number;
    bits?: 8 | 16;
    stored?: number;
    photometric?: string;
    samples?: number;
    signed?: boolean;
    values?: number[];
    slope?: number;
    intercept?: number;
    center?: number | number[];
    widthWindow?: number | number[];
    voiFunction?: string;
    presentationShape?: string;
    syntax?: string;
    compressed?: Buffer;
    noPixels?: boolean;
  } = {},
) {
  const syntax = options.syntax || '1.2.840.10008.1.2.1',
    little = syntax !== '1.2.840.10008.1.2.2',
    implicit = syntax === '1.2.840.10008.1.2';
  const width = options.width || 2,
    height = options.height || 2,
    frames = options.frames || 1,
    bits = options.bits || 16,
    samples = options.samples || 1;
  const txt = (g: number, t: number, vr: string, v: string) =>
    element(g, t, vr, Buffer.from(v), little, implicit);
  const us = (g: number, t: number, v: number) => {
    const b = Buffer.alloc(2);
    if (little) b.writeUInt16LE(v);
    else b.writeUInt16BE(v);
    return element(g, t, 'US', b, little, implicit);
  };
  const meta = [
    element(2, 1, 'OB', Buffer.from([0, 1])),
    element(2, 2, 'UI', Buffer.from('1.2.840.10008.5.1.4.1.1.7')),
    element(2, 3, 'UI', Buffer.from('2.25.1')),
    element(2, 16, 'UI', Buffer.from(syntax)),
    element(2, 18, 'UI', Buffer.from('2.25.9')),
  ];
  const length = Buffer.alloc(4);
  length.writeUInt32LE(Buffer.concat(meta).length);
  const tags = [
    txt(8, 22, 'UI', '1.2.840.10008.5.1.4.1.1.7'),
    txt(8, 24, 'UI', '2.25.1'),
    txt(8, 96, 'CS', samples === 3 ? 'OT' : 'CT'),
    txt(16, 16, 'PN', 'Synthetic^Patient'),
    txt(16, 32, 'LO', 'FAKE-ONLY'),
    txt(32, 13, 'UI', '2.25.2'),
    txt(32, 14, 'UI', '2.25.3'),
    txt(32, 19, 'IS', '1'),
    us(40, 2, samples),
    txt(40, 4, 'CS', options.photometric || (samples === 3 ? 'RGB' : 'MONOCHROME2')),
    txt(40, 8, 'IS', String(frames)),
    us(40, 16, height),
    us(40, 17, width),
    us(40, 256, bits),
    us(40, 257, options.stored || bits),
    us(40, 258, (options.stored || bits) - 1),
    us(40, 259, options.signed ? 1 : 0),
  ];
  if (samples === 3) tags.push(us(40, 6, 0));
  if (options.intercept !== undefined) tags.push(txt(40, 4178, 'DS', String(options.intercept)));
  if (options.slope !== undefined) tags.push(txt(40, 4179, 'DS', String(options.slope)));
  if (options.center !== undefined)
    tags.push(
      txt(
        40,
        4176,
        'DS',
        Array.isArray(options.center) ? options.center.join('\\') : String(options.center),
      ),
    );
  if (options.widthWindow !== undefined)
    tags.push(
      txt(
        40,
        4177,
        'DS',
        Array.isArray(options.widthWindow)
          ? options.widthWindow.join('\\')
          : String(options.widthWindow),
      ),
    );
  if (options.voiFunction) tags.push(txt(40, 4182, 'CS', options.voiFunction));
  if (options.presentationShape) tags.push(txt(0x2050, 0x20, 'CS', options.presentationShape));
  // DICOM elements must be in ascending tag order, including optional fields.
  tags.sort((a, b) => {
    const read = (v: Buffer) =>
      little
        ? v.readUInt16LE(0) * 65536 + v.readUInt16LE(2)
        : v.readUInt16BE(0) * 65536 + v.readUInt16BE(2);
    return read(a) - read(b);
  });
  if (!options.noPixels) {
    if (options.compressed) {
      const h = Buffer.alloc(12);
      h.writeUInt16LE(0x7fe0);
      h.writeUInt16LE(0x10, 2);
      h.write('OB', 4);
      h.writeUInt32LE(0xffffffff, 8);
      const item = (body: Buffer) => {
        const b = Buffer.alloc(8);
        b.writeUInt16LE(0xfffe);
        b.writeUInt16LE(0xe000, 2);
        b.writeUInt32LE(body.length, 4);
        return Buffer.concat([b, body]);
      };
      const end = Buffer.from([254, 255, 221, 224, 0, 0, 0, 0]);
      let compressed = options.compressed;
      if (compressed.length % 2) compressed = Buffer.concat([compressed, Buffer.alloc(1)]);
      tags.push(Buffer.concat([h, item(Buffer.alloc(0)), item(compressed), end]));
    } else {
      const values =
        options.values ||
        Array.from({ length: width * height * frames * samples }, (_, i) => i * 100);
      const pixels = Buffer.alloc((values.length * bits) / 8);
      values.forEach((v, i) => {
        if (bits === 8) pixels.writeUInt8(v, i);
        else if (options.signed) {
          if (little) pixels.writeInt16LE(v, i * 2);
          else pixels.writeInt16BE(v, i * 2);
        } else {
          if (little) pixels.writeUInt16LE(v, i * 2);
          else pixels.writeUInt16BE(v, i * 2);
        }
      });
      tags.push(element(0x7fe0, 0x10, bits === 8 ? 'OB' : 'OW', pixels, little, implicit));
    }
  }
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM'),
    element(2, 0, 'UL', length),
    ...meta,
    ...tags,
  ]);
}

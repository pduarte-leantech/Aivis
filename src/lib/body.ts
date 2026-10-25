import { ApiError } from './auth';
/** Bound bodies before parsing so chunked requests cannot bypass size limits. */
export async function boundedBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes)
    throw new ApiError(413, 'O corpo da requisição excede o limite permitido.');
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'O corpo da requisição excede o limite permitido.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
export async function readJson(request: Request) {
  const bytes = await boundedBody(request, 128 * 1024);
  return JSON.parse(new TextDecoder().decode(bytes));
}

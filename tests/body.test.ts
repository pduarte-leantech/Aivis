import { expect, it } from 'vitest';
import { boundedBody, readJson } from '../src/lib/body';
it('rejects chunked requests exceeding the parser budget without a Content-Length header', async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(600));
      c.enqueue(new Uint8Array(600));
      c.close();
    },
  });
  const request = new Request('https://example.invalid', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit);
  await expect(boundedBody(request, 1000)).rejects.toThrow('excede');
});
it('parses only bounded JSON bodies', async () => {
  expect(
    await readJson(
      new Request('https://example.invalid', { method: 'POST', body: '{"consent":true}' }),
    ),
  ).toEqual({ consent: true });
  await expect(
    readJson(new Request('https://example.invalid', { method: 'POST', body: 'invalid' })),
  ).rejects.toThrow();
});

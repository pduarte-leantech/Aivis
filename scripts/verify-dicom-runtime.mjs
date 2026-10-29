/** Verify that the actual Next/Vercel file trace can decode DICOM without the checkout. */
import { mkdtemp, readFile, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { makeDicom } from '../tests/fixtures/dicom.ts';
const project = process.cwd(),
  tracePath = join(project, '.next/server/app/api/v1/[...path]/route.js.nft.json');
const trace = JSON.parse(await readFile(tracePath, 'utf8'));
const sandbox = await mkdtemp(join(tmpdir(), 'aivis-runtime-check-'));
try {
  const entries = trace.files.map((file) => resolve(dirname(tracePath), file));
  for (const source of entries) {
    const target = relative(project, source);
    if (target.startsWith('..'))
      throw new Error('A dependência do worker saiu da raiz do projeto.');
    await mkdir(dirname(join(sandbox, target)), { recursive: true });
    await cp(source, join(sandbox, target), { dereference: true, recursive: true });
  }
  const directory = join(sandbox, 'work');
  await mkdir(directory, { mode: 0o700 });
  const buffer = Uint8Array.from(makeDicom({ frames: 2 })).buffer;
  await new Promise((accept, reject) => {
    const worker = new Worker(join(sandbox, 'scripts/dicom-worker.mjs'), {
      workerData: { buffer, directory },
      transferList: [buffer],
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let result;
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('O worker empacotado excedeu o tempo de teste.'));
    }, 45000);
    worker.once('message', (message) => {
      result = message;
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (
        code !== 0 ||
        result?.error ||
        result?.images?.length !== 2 ||
        result.metadata.frames !== 2
      )
        reject(new Error('O artefato de produção não decodificou os dois frames DICOM.'));
      else accept();
    });
  });
  console.log(
    'Artefato Next/Vercel validado: worker, bibliotecas, WASM e extração dos dois frames PNG funcionam fora do checkout.',
  );
} finally {
  await rm(sandbox, { recursive: true, force: true });
}

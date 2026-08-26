// F4½ python sandbox: pyodide (WASM CPython) inside a worker thread.
//
// Isolation properties the experiment depends on:
//  - FRESH interpreter per run — a shared one would leak state (variables,
//    imports, monkey-patches) between agents, which is a privacy hole in a
//    room where code and output are journal-class private.
//  - No network: pyodide in Node has no fetch bridge wired here, and the
//    stdlib-only distribution loads offline (loadPackage/CDN never called).
//  - Shared files are mounted READ-ONLY in spirit: the worker copies them
//    into the interpreter's FS before the run; nothing is synced back.
//    Publishing results happens through [WRITE], audibly, not as a side
//    effect of running code.
//  - Wall-clock timeout via worker.terminate() — an infinite loop costs the
//    caller their output, never the session.
//
// ROOM_STUB=1 returns a deterministic fake (echoes a marker + first code
// line) so the whole tool path dry-runs without loading WASM.

import { Worker } from 'node:worker_threads';

const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { loadPyodide } = require('pyodide');
  const lines = [];
  const py = await loadPyodide({
    stdout: (s) => lines.push(s),
    stderr: (s) => lines.push(s),
  });
  py.setStdout({ batched: (s) => lines.push(s) });
  py.setStderr({ batched: (s) => lines.push(s) });
  for (const [name, content] of Object.entries(workerData.files ?? {})) {
    try { py.FS.writeFile('/home/pyodide/' + name, content); } catch {}
  }
  try {
    const result = await py.runPythonAsync(workerData.code);
    if (result !== undefined && result !== null) lines.push(String(result));
    parentPort.postMessage({ ok: true, output: lines.join('\\n') });
  } catch (err) {
    parentPort.postMessage({ ok: false, output: lines.join('\\n'), error: String(err).slice(0, 2000) });
  }
})().catch((err) => parentPort.postMessage({ ok: false, output: '', error: String(err).slice(0, 500) }));
`;

const MAX_OUTPUT_CHARS = 4000;

export async function runPython(code: string, files: Record<string, string>, timeoutSeconds: number): Promise<string> {
  if (process.env.ROOM_STUB === '1') {
    return `stub-python-output: ${code.split('\n')[0].slice(0, 80)}`;
  }
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SRC, { eval: true, workerData: { code, files } });
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + '\n…(output truncated)' : text);
    };
    const timer = setTimeout(
      () => finish(`(execution timed out after ${timeoutSeconds}s)`),
      timeoutSeconds * 1000,
    );
    worker.on('message', (m: { ok: boolean; output: string; error?: string }) => {
      finish(m.ok ? m.output || '(no output)' : `${m.output ? m.output + '\n' : ''}Error: ${m.error}`);
    });
    worker.on('error', (err) => finish(`Error: ${String(err).slice(0, 500)}`));
  });
}

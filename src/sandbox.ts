// F4½ python sandbox: pyodide (WASM CPython) inside a worker thread.
//
// Isolation properties the experiment depends on:
//  - FRESH interpreter per run — a shared one would leak state (variables,
//    imports, monkey-patches) between agents, which is a privacy hole in a
//    room where code and output are journal-class private.
//  - The AGENT'S CODE has no network. The loader is the one exception:
//    packages on the preload list (ToolsConfig.pythonPackages) are fetched
//    from the pyodide CDN, cached on disk after the first container use.
//    Agents cannot extend the list — imports of anything unloaded simply
//    fail (joint-session lesson), and micropip is deliberately never
//    loaded (it would turn the loader into an install-anything hole).
//  - Shared files are mounted READ-ONLY in spirit: the worker copies them
//    into the interpreter's FS before the run; nothing is synced back.
//    Publishing results happens through [WRITE], audibly, not as a side
//    effect of running code.
//  - Two-phase timeout: package preload gets its own generous cap; the
//    per-run wall clock (worker.terminate() past it) starts only once the
//    interpreter reports ready, so preloading never eats the agent's
//    compute budget. An infinite loop costs the caller their output,
//    never the session.
//
// ROOM_STUB=1 returns a deterministic fake (echoes a marker + first code
// line) so the whole tool path dry-runs without loading WASM.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { loadPyodide } = require('pyodide');
  const lines = [];
  const py = await loadPyodide({
    packageCacheDir: workerData.cacheDir,
    stdout: (s) => lines.push(s),
    stderr: (s) => lines.push(s),
  });
  let loadNote = '';
  if (workerData.packages.length) {
    try {
      // messageCallback silenced: load progress is loader noise, not the
      // agent's output.
      await py.loadPackage(workerData.packages, { messageCallback: () => {} });
    } catch (err) {
      loadNote = '(note: preloaded packages unavailable this run — standard library only)\\n';
    }
  }
  py.setStdout({ batched: (s) => lines.push(s) });
  py.setStderr({ batched: (s) => lines.push(s) });
  for (const [name, content] of Object.entries(workerData.files ?? {})) {
    try { py.FS.writeFile('/home/pyodide/' + name, content); } catch {}
  }
  parentPort.postMessage({ type: 'ready' });
  try {
    const result = await py.runPythonAsync(workerData.code);
    if (result !== undefined && result !== null) lines.push(String(result));
    parentPort.postMessage({ type: 'done', ok: true, output: loadNote + lines.join('\\n') });
  } catch (err) {
    parentPort.postMessage({ type: 'done', ok: false, output: loadNote + lines.join('\\n'), error: String(err).slice(0, 2000) });
  }
})().catch((err) => parentPort.postMessage({ type: 'done', ok: false, output: '', error: String(err).slice(0, 500) }));
`;

const MAX_OUTPUT_CHARS = 4000;
/** First load downloads packages from the CDN; cached after that. */
const PRELOAD_TIMEOUT_SECONDS = 180;

export async function runPython(
  code: string,
  files: Record<string, string>,
  timeoutSeconds: number,
  packages: string[] = [],
): Promise<string> {
  if (process.env.ROOM_STUB === '1') {
    return `stub-python-output: ${code.split('\n')[0].slice(0, 80)}`;
  }
  const cacheDir = join(import.meta.dirname, '..', '.pyodide-cache');
  mkdirSync(cacheDir, { recursive: true });
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SRC, { eval: true, workerData: { code, files, packages, cacheDir } });
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + '\n…(output truncated)' : text);
    };
    // Phase 1: interpreter + package preload (generous, loader's problem).
    timer = setTimeout(
      () => finish(`(sandbox failed to start within ${PRELOAD_TIMEOUT_SECONDS}s)`),
      PRELOAD_TIMEOUT_SECONDS * 1000,
    );
    worker.on('message', (m: { type: string; ok?: boolean; output?: string; error?: string }) => {
      if (m.type === 'ready') {
        // Phase 2: the agent's own wall clock starts now.
        clearTimeout(timer);
        timer = setTimeout(() => finish(`(execution timed out after ${timeoutSeconds}s)`), timeoutSeconds * 1000);
        return;
      }
      finish(m.ok ? m.output || '(no output)' : `${m.output ? m.output + '\n' : ''}Error: ${m.error}`);
    });
    worker.on('error', (err) => finish(`Error: ${String(err).slice(0, 500)}`));
  });
}

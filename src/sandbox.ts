// F4½ python sandbox: pyodide (WASM CPython) inside a worker thread.
//
// Properties the experiment depends on:
//  - FRESH interpreter per run — a shared one would leak state (variables,
//    imports, monkey-patches) between agents, which is a privacy hole in a
//    room where code and output are journal-class private.
//  - The room's shared files are mounted at shared/ (read AND write):
//    anything the code saves there — text or binary, a matplotlib PNG
//    included — comes back as changed files and is PUBLISHED to the room
//    as shared-file events (audible, attributed to the caller). stdout
//    stays private; the filesystem is the publishing surface.
//  - Preloaded packages (ToolsConfig.pythonPackages) come from the pyodide
//    CDN once per container (cached). With pythonInstall, micropip is also
//    loaded so agents can install more themselves inside a run — their
//    choice, their time budget. (Caveat acknowledged in types.ts: micropip
//    gives agent code an outbound fetch channel via the installer.)
//  - Two-phase timeout: interpreter + preload get their own generous cap;
//    the per-run wall clock (worker.terminate() past it) starts once the
//    interpreter reports ready, so preloading never eats the agent's
//    budget. An infinite loop costs the caller their output, never the
//    session.
//
// ROOM_STUB=1 returns a deterministic fake (echoes a marker + first code
// line; publishes a stub file when the code mentions write_shared) so the
// whole tool path dry-runs without loading WASM.

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
  const toLoad = [...workerData.packages];
  if (workerData.install) toLoad.push('micropip');
  if (toLoad.length) {
    try {
      await py.loadPackage(toLoad, { messageCallback: () => {} });
    } catch (err) {
      loadNote = '(note: preloaded packages unavailable this run — standard library only)\\n';
    }
  }
  py.setStdout({ batched: (s) => lines.push(s) });
  py.setStderr({ batched: (s) => lines.push(s) });
  py.FS.mkdirTree('/home/pyodide/shared');
  const before = new Map();
  for (const [name, b64] of Object.entries(workerData.files ?? {})) {
    try {
      // A name may carry folders (tools.directories); make them before the
      // write, or the file silently fails to mount.
      const slash = name.lastIndexOf('/');
      if (slash > 0) py.FS.mkdirTree('/home/pyodide/shared/' + name.slice(0, slash));
      py.FS.writeFile('/home/pyodide/shared/' + name, Buffer.from(b64, 'base64'));
      before.set(name, b64);
    } catch {}
  }
  parentPort.postMessage({ type: 'ready' });
  // RECURSIVE: a room with folders can save shared/src/parser.py, and a
  // flat readdir would have walked straight past it — the file would exist
  // inside the sandbox, vanish with the interpreter, and never reach the
  // room. Depth-capped so a runaway mkdir loop cannot hang the collect.
  const collectChanged = () => {
    const changed = [];
    const walk = (rel, depth) => {
      if (depth > 6) return;
      const dir = '/home/pyodide/shared' + (rel ? '/' + rel : '');
      let entries = [];
      try { entries = py.FS.readdir(dir); } catch { return; }
      for (const entry of entries) {
        if (entry === '.' || entry === '..') continue;
        const name = rel ? rel + '/' + entry : entry;
        try {
          const stat = py.FS.stat(dir + '/' + entry);
          if (py.FS.isDir(stat.mode)) { walk(name, depth + 1); continue; }
          const b64 = Buffer.from(py.FS.readFile(dir + '/' + entry)).toString('base64');
          if (before.get(name) !== b64) changed.push({ name, dataBase64: b64 });
        } catch {}
      }
    };
    walk('', 0);
    return changed;
  };
  try {
    const result = await py.runPythonAsync(workerData.code);
    if (result !== undefined && result !== null) lines.push(String(result));
    parentPort.postMessage({ type: 'done', ok: true, output: loadNote + lines.join('\\n'), files: collectChanged() });
  } catch (err) {
    parentPort.postMessage({ type: 'done', ok: false, output: loadNote + lines.join('\\n'), error: String(err).slice(0, 2000), files: collectChanged() });
  }
})().catch((err) => parentPort.postMessage({ type: 'done', ok: false, output: '', error: String(err).slice(0, 500), files: [] }));
`;

const MAX_OUTPUT_CHARS = 4000;
/** First load downloads packages from the CDN; cached after that. */
const PRELOAD_TIMEOUT_SECONDS = 180;

export interface RunResult {
  output: string;
  /** shared/ files the code created or changed, to publish to the room. */
  files: { name: string; dataBase64: string }[];
}

export async function runPython(
  code: string,
  files: Record<string, Buffer>,
  timeoutSeconds: number,
  packages: string[] = [],
  install = false,
): Promise<RunResult> {
  if (process.env.ROOM_STUB === '1') {
    return {
      output: `stub-python-output: ${code.split('\n')[0].slice(0, 80)}`,
      files: code.includes('write_shared')
        ? [{ name: 'stub-artifact.png', dataBase64: Buffer.from('stub-binary-artifact').toString('base64') }]
        : [],
    };
  }
  const cacheDir = join(import.meta.dirname, '..', '.pyodide-cache');
  mkdirSync(cacheDir, { recursive: true });
  const filesB64 = Object.fromEntries(Object.entries(files).map(([n, b]) => [n, b.toString('base64')]));
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SRC, { eval: true, workerData: { code, files: filesB64, packages, install, cacheDir } });
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      const output = r.output.length > MAX_OUTPUT_CHARS ? r.output.slice(0, MAX_OUTPUT_CHARS) + '\n…(output truncated)' : r.output;
      resolve({ output, files: r.files });
    };
    // Phase 1: interpreter + package preload (generous, loader's problem).
    timer = setTimeout(
      () => finish({ output: `(sandbox failed to start within ${PRELOAD_TIMEOUT_SECONDS}s)`, files: [] }),
      PRELOAD_TIMEOUT_SECONDS * 1000,
    );
    worker.on('message', (m: { type: string; ok?: boolean; output?: string; error?: string; files?: { name: string; dataBase64: string }[] }) => {
      if (m.type === 'ready') {
        // Phase 2: the agent's own wall clock starts now.
        clearTimeout(timer);
        timer = setTimeout(() => finish({ output: `(execution timed out after ${timeoutSeconds}s)`, files: [] }), timeoutSeconds * 1000);
        return;
      }
      finish({
        output: m.ok ? m.output || '(no output)' : `${m.output ? m.output + '\n' : ''}Error: ${m.error}`,
        files: m.files ?? [],
      });
    });
    worker.on('error', (err) => finish({ output: `Error: ${String(err).slice(0, 500)}`, files: [] }));
  });
}

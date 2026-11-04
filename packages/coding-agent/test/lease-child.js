import { createLocalWorkspace } from '../dist/node/index.js';
try {
  const workspace = await createLocalWorkspace({ root: process.argv[2], shell: 'powershell' });
  const lease = await workspace.acquire();
  console.log('ACQUIRED');
  if (process.argv[3] === 'run') await lease.runCommand({ command: 'node tree.cjs', timeoutMs: 20000 }, { signal: new AbortController().signal });
  if (process.argv[3] === 'hold') await new Promise(resolve => { process.stdin.once('data', resolve); process.stdin.resume(); });
  await lease.release(); await workspace.close(); process.stdin.pause();
} catch (cause) { console.log(cause.code); process.exitCode = cause.code === 'WORKSPACE_BUSY' ? 0 : 1; }

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const files = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.js')).map(f => fileURLToPath(new URL(f, import.meta.url)));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

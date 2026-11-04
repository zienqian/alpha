import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const files = readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.test.js'));
const result = spawnSync(process.execPath, ['--test', ...files.map(name => fileURLToPath(new URL(name, import.meta.url)))], { stdio: 'inherit' });
process.exit(result.status ?? 1);

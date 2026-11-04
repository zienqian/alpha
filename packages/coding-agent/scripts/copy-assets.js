import { copyFile } from 'node:fs/promises';
for (const name of ['bridge.ps1', 'bridge.cs']) {
  await copyFile(new URL(`../src/node/${name}`, import.meta.url), new URL(`../dist/node/${name}`, import.meta.url));
}

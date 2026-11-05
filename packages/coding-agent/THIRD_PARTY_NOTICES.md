# OpenCode process execution reference

`src/process/shell.ts` and `src/process/run-command.ts` adapt the shell selection and process lifecycle approach from OpenCode, pinned to commit `2f31b3d52c3ef8c7a2a338f368b1ba2e07b44e9e`:

- https://github.com/anomalyco/opencode/blob/2f31b3d52c3ef8c7a2a338f368b1ba2e07b44e9e/packages/core/src/shell/select.ts
- https://github.com/anomalyco/opencode/blob/2f31b3d52c3ef8c7a2a338f368b1ba2e07b44e9e/packages/util/src/cross-spawn-spawner.ts

Alpha changes: plain functions instead of Effect services; a fixed per-agent shell; bounded in-memory UTF-8 output; host environment allowlist; PowerShell 5.1 UTF-8/text output; executable existence checks; argv-based Windows taskkill; explicit never-started/unknown outcomes. Uses cross-spawn 7.0.6 directly. No OpenCode package or C# bridge is loaded. Windows uses overlapped pipes, POSIX uses detached process groups and TERM → KILL after 3 seconds; output drain after root exit is capped at 1 second. This does not reproduce OpenCode's entire process service or guarantee cleanup after forced host death.

## Upstream MIT license

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

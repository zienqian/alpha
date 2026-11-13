# Bundled runtime components

The desktop distribution includes the Bun binary used to build it and the local
ripgrep binary (or `ALPHACODE_APP_RG`). Build on the target OS and CPU architecture.

- Bun: https://github.com/oven-sh/bun — MIT, see `Bun-LICENSE.md` and its bundled dependency notices.
- ripgrep: https://github.com/BurntSushi/ripgrep — MIT or Unlicense, see `ripgrep-LICENSE-MIT`.
- Electron and Chromium notices are included by Electron Packager in the application directory.
- CLI (including OpenTUI) and server dependencies retain their license files in `runtime/node_modules`.
- Web UI fonts and Multica attribution remain in `apps/alphacode-web/dist/third-party`.

License texts retrieved from the upstream repositories on 2026-11-13.

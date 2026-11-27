# @alpha/adk-memory

Local-first cross-session persistent memory extension for Alpha ADK, combining Claude Code's Markdown topic files (`MEMORY.md` ≤ 200 lines + `topics/*.md` YAML frontmatter + 4-phase Auto-Dream) with OpenAI Codex's SQLite lease-coordinated two-stage background pipeline (`stage1_outputs` + `memory_jobs`).

- `@alpha/adk-memory`: Pure core contracts, frontmatter/200-line index compaction, secret sanitizer, ADK plugin (`createMemoryPlugin`), Stage 1 rollout extractor (`runStage1Extraction`), and Stage 2 Auto-Dream consolidator (`runStage2Dream`).
- `@alpha/adk-memory/fs`: Local Markdown store under `~/.alphacode/memory/{user,projects/<id>,bots/<id>}/` with atomic writes, `owner: user` lock enforcement, and `.snapshots/` rollback.
- `@alpha/adk-memory/sqlite`: Zero-external-dependency `bun:sqlite` WAL coordinator (`memory_jobs`, `stage1_outputs`, derived `memory_files` + dual English/CJK FTS5).

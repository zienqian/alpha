# Legacy SQLite fixtures

`session-v1.sqlite` was created on 2026-11-05 with Node 26.13.0 and the
pre-migration `better-sqlite3` Session adapter, before rebuilding for Bun.
It contains one offline user/assistant turn, a saved request receipt and
Chinese text. It contains no credentials or user conversation data.

`session-bun-v1.sqlite` was created on 2026-11-05 with Bun 1.4.4 and the
`bun:sqlite` Session adapter, before restoring the `better-sqlite3` driver.
It also contains one offline turn and saved request receipt, with
`metadata.driver` identifying its writer as `bun:sqlite`.

The compatibility test copies each file before writing, verifies receipt
replay without model execution, continues the conversation, and checks
that the original turn and database schema version remain unchanged.

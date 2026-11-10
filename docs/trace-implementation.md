# Trace implementation

Implemented on 2026-11-10. The [T2 design](adk-trace-design-t1.html) remains the design
baseline; this document records the shipped code and concrete differences.

## Entry and integration

In AlphaCode Web, use **执行记录 / Execution records** beside the copy button below
the final model reply. It opens that reply's run directly, matching either the live
model-call ID or the restored assistant-message ID; missing records have an explicit
empty state. The daemon enables collection by default; set
`ALPHACODE_TRACE=0` before starting AlphaCode to disable new collection for that
configuration. Existing records remain readable. Old conversations without Trace
records display an empty state; their timings are not reconstructed from message order.

`packages/adk-trace` is independently installable in this workspace and works with
plain ADK without Session. It consumes optional versioned event telemetry from ADK:
source wall time, monotonic run offsets, model and tool IDs, message references,
reported usage, and bounded error codes. It owns neither prompts nor execution.
The Alpha runtime bridges approval waits, tool business results, and Session save
status. Closing one agent does not close the shared Trace service.

## Data and transport

`traces.db` is separate from the Session database. All SQLite work is in a Worker,
using WAL transactions and guarded revision upserts. Schema v1 stores a bounded
materialized snapshot per run in `trace_runs`; it does **not** keep the T2 draft's
separate `trace_records` event log. This avoids retaining duplicate lifecycle data;
restart recovery uses the committed projection. Event replay/rebuilding alternative
projections from raw records is not provided by this version.

The database contains metadata and message IDs only. Input/output details are
resolved from the owning immutable Session turn or active runtime on demand,
redacted before returning, and capped at 16,000 characters per detail. Secret
patterns and sensitive argument keys are filtered; this is defense in depth, not
a claim that arbitrary prose can be made secret-free. Read access inherits the
existing local daemon Host/Origin/authentication checks. Client-supplied namespace
and filesystem paths are never used to fetch details.

All routes are under `/api/sessions/:sid/traces`:

| Route | Contract |
| --- | --- |
| `GET /` | Keyset-paged run history; limit 1–200, default 50 |
| `GET /events` | SSE invalidation snapshots with instanceId/revision; reconnect refreshes data |
| `GET /by-reply?replyId=` | Scoped lookup for a live or restored reply; no latest-run fallback |
| `GET /:tid` | Summary and capture/store health |
| `GET /:tid/view` | One consistent bounded metadata view, lanes, step previews and outcomes |
| `GET /:tid/steps` | Revision-bound cursor; q/kind/tool/direction filters; stable cross-page group IDs/counts |
| `GET /:tid/steps/:stepId/detail` | Lazy, scoped, redacted original content |
| `GET /:tid/search?q=` | Whole-run input and first 4,000 output characters, matching Multica's search window |
| `GET /:tid/spans` | Span metadata and revision |
| `POST /:tid/copy` | Selected step IDs, bounded redacted content, explicit truncation flag |
| `GET /:tid/export` | Metadata-only JSON export |

Wrong session/trace/step ownership returns 404. Invalid queries return 400 and
changed revision-bound cursors return 409. JSON copy requests use the existing
same-origin mutation policy. No credentials are needed to rehydrate a model just
to read historical traces: historical reads do not start an agent.

The current Web UI loads the bounded `/view` projection atomically and virtualizes
its rows. It does not stitch several moving step pages together; `/steps` is
available for other consumers. Assistant preview bodies share a 256 KiB character
budget; tool bodies are fetched only on selection/search/copy. Run history uses
cursor paging. SSE invalidations are coalesced for 250 ms in the client, and polling
is used during disconnection. Exact source durations are distinguished from
missing starts and unknown durations. No cost, reasoning text, git branch, or
successful file change is invented when evidence is absent.

## Multica visual source

Reference: `multica-ai/multica` commit
`10f0ab332e57035feadae43cff2cd511f0d1d1f1`, the **single-run Agent Transcript dialog**.
The port uses its tokens, Inter/Geist Mono fonts, icon glyphs, row geometry, dual
timeline, grouping threshold, source presenter/diff algorithms and Lowlight grammar
and colors. Source files and changes are recorded in the public third-party manifest.

Dialog width 1024 px, viewport inset 32 px, radius 12 px; two 15 px timeline tracks;
92 px labels; 44 px row offsets; 416 px inspector. Compact tool rows, inline Markdown,
three-or-more same-tool grouping, individually displayed commands, zoom, search,
filters, ordering, selection, copy, and clipped detail expansion are implemented.
On narrow screens the inspector replaces the list. The host language/theme applies
to a scoped token surface without changing the rest of AlphaCode.

The full upstream LICENSE/NOTICE and font licenses are retained under
`apps/alphacode-web/public/third-party/multica`. Upstream's LICENSE includes Part I
conditions in addition to Apache-2.0; the run-info popup retains Multica attribution.
This change performs no deployment or publication.

## Verification and limits

- ADK: 73 existing tests passed after the telemetry changes.
- Standalone Trace: isolation, no Session dependency, content exclusion, pairing,
  duplicates/out-of-order events, store failures, queue overflow, SQLite ownership,
  restart recovery and scoped deletion.
- AlphaCode: 118 tests passed, including real-tool trace capture, business failures,
  search/copy redaction, metadata export, cross-session rejection, revision fencing,
  cursor filtering, idempotent request replay, and history after restart.
- Web: 119-test suite passed, followed by the four Trace tests after the final
  changes (including a new syntax-highlighting HTML-escaping check). Coverage also
  includes grouping, attached portal/focus handling, empty usage, Escape and stream
  cancellation. Node 26 tests used
  `NODE_OPTIONS=--no-experimental-webstorage` to let jsdom own localStorage.
- Production build, TypeScript, dependency boundaries and localization checks.
- Actual app exercised at desktop and 390 px viewport: history entry, grouped steps,
  search results, file-change inspector, and narrow-screen inspector replacement.

Original Multica running screenshots have not been compared pixel by pixel against
identical data. Source-based visual parity is implemented; screenshot-diff parity
and the T2 performance percentile targets are not claimed as measured results.
Raw image/base64 outputs are not added to the telemetry contract; Markdown images
are suppressed rather than initiating unsolicited remote image loads.

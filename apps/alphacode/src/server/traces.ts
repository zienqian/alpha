import type { Message } from "@alpha/adk/core";
import type { TraceScope, TraceService, TraceSnapshot } from "@alpha/adk-trace";
import {
  buildTraceDetail,
  buildTraceView,
  searchTraceSteps,
} from "./trace-view";
import { fail } from "./security";
import { traceStepPage } from "./trace-pages";

export interface TraceSessionSource {
  scope: TraceScope;
  workspace: string;
  messages(snapshot: TraceSnapshot): Promise<readonly Message[]>;
}
export function createTraceRoutes(options: {
  service: TraceService;
  session(id: string): Promise<TraceSessionSource | undefined>;
  stream(request: Request): Response;
}) {
  return async (request: Request, url: URL): Promise<Response | undefined> => {
    const match = /^\/api\/sessions\/([^/]+)\/traces(?:\/(.*))?$/.exec(
      url.pathname,
    );
    if (!match) return;
    const copying = request.method === "POST" && match[2]?.endsWith("/copy");
    if (request.method !== "GET" && !copying)
      return fail(405, "METHOD_NOT_ALLOWED");
    const source = await options.session(decodeURIComponent(match[1]!));
    if (!source) return fail(404, "SESSION_NOT_FOUND");
    const tail = match[2];
    if (!tail) {
      try {
        return Response.json({
          ...(await options.service.list(source.scope, {
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 50),
          })),
          health: options.service.health,
        });
      } catch (error) {
        if (
          /^TRACE_(CURSOR|LIMIT)_INVALID$/.test(
            (error as { code?: string }).code ?? "",
          )
        )
          return fail(400, "INVALID_QUERY");
        throw error;
      }
    }
    if (tail === "events") return options.stream(request);
    if (tail === "by-reply") {
      const replyId = url.searchParams.get("replyId");
      if (!replyId || replyId.length > 512) return fail(400, "INVALID_QUERY");
      const trace = await options.service.findByReply(source.scope, replyId);
      return Response.json({ traceId: trace?.traceId ?? null });
    }
    const [traceId, action, stepId, detail, ...extra] = tail.split("/");
    if (!traceId || !/^[a-f0-9]{32}$/.test(traceId) || extra.length)
      return fail(404, "TRACE_NOT_FOUND");
    const snapshot = await options.service.get(source.scope, traceId);
    if (!snapshot) return fail(404, "TRACE_NOT_FOUND");
    if (
      url.searchParams.has("revision") &&
      Number(url.searchParams.get("revision")) !== snapshot.summary.revision
    )
      return fail(409, "TRACE_REVISION_CHANGED");
    if (!action)
      return Response.json({
        summary: snapshot.summary,
        health: options.service.health,
      });
    if (action === "view" && !stepId)
      return Response.json(
        buildTraceView(
          snapshot,
          await source.messages(snapshot),
          options.service.health,
          source.workspace,
        ),
      );
    if (action === "search" && !stepId) {
      const query = url.searchParams.get("q") ?? "";
      if (query.length > 500) return fail(400, "INVALID_QUERY");
      return Response.json({
        stepIds: searchTraceSteps(
          snapshot,
          await source.messages(snapshot),
          query,
        ),
        revision: snapshot.summary.revision,
      });
    }
    if (action === "copy" && copying && !stepId) {
      if (
        request.headers.get("content-type")?.split(";")[0] !==
        "application/json"
      )
        return fail(415, "JSON_REQUIRED");
      const body = await request.text();
      if (body.length > 1024 * 1024) return fail(413, "PAYLOAD_TOO_LARGE");
      let ids: unknown;
      try {
        ids = (JSON.parse(body) as { stepIds?: unknown }).stepIds;
      } catch {
        return fail(400, "INVALID_QUERY");
      }
      if (
        !Array.isArray(ids) ||
        ids.length > 20000 ||
        ids.some((id) => typeof id !== "string" || id.length > 512)
      )
        return fail(400, "INVALID_QUERY");
      const messages = await source.messages(snapshot),
        parts: string[] = [];
      let remaining = 1024 * 1024,
        truncated = false;
      for (const [position, id] of ids.entries()) {
        const value = buildTraceDetail(snapshot, messages, id);
        if (!value) continue;
        const text = [
          value.input && JSON.stringify(value.input, null, 2),
          value.output,
          value.content,
        ]
          .filter(Boolean)
          .join("\n\n");
        truncated ||= value.state === "truncated" || text.length > remaining;
        parts.push(text.slice(0, remaining));
        remaining -= Math.min(text.length + 2, remaining);
        if (remaining === 0) {
          truncated ||= position < ids.length - 1;
          break;
        }
      }
      return Response.json({ text: parts.join("\n\n"), truncated });
    }
    if (action === "steps" && !stepId)
      return Response.json(
        traceStepPage(
          snapshot,
          await source.messages(snapshot),
          url.searchParams,
        ),
      );
    if (action === "steps" && stepId && detail === "detail") {
      const value = buildTraceDetail(
        snapshot,
        await source.messages(snapshot),
        decodeURIComponent(stepId),
      );
      return value ? Response.json(value) : fail(404, "TRACE_STEP_NOT_FOUND");
    }
    if (action === "spans" && !stepId)
      return Response.json({
        items: snapshot.spans,
        revision: snapshot.summary.revision,
      });
    if (action === "export" && !stepId)
      return new Response(JSON.stringify(snapshot, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="trace-${traceId}.json"`,
        },
      });
    return fail(404, "NOT_FOUND");
  };
}

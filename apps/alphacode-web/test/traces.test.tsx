import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "./render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TraceView, TraceViewStep } from "@alpha/adk-trace/contracts";
import { TraceSurface } from "@/features/traces/primitives";
import { TraceLauncher } from "@/features/traces/trace-launcher";
import {TooltipProvider} from '@/components/ui/tooltip';
import { TranscriptRow } from "@/features/traces/transcript-rows";
import { groupRows } from "@/features/traces/format";
import { useTracePortal } from "@/features/traces/primitives";
import {highlightBlock} from '@/features/traces/vendor/diff-highlight';

const call = (id: string): TraceViewStep => ({
  stepId: id,
  seq: Number(id),
  kind: "call",
  label: "read_file",
  summary: `file-${id}.ts`,
  offsetMs: Number(id) * 10,
  durationMs: 5,
  status: "ok",
  shape: "read",
  detailState: "available",
});
describe("Trace interactions", () => {
  it('escapes tool content before adding syntax highlighting markup',()=>{
    const html=highlightBlock('<img src=x onerror=alert(1)>','typescript');
    const parsed=new DOMParser().parseFromString(html??'','text/html');
    expect(parsed.querySelector('img')).toBeNull();expect(parsed.body.textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it("folds three same-tool calls and keeps commands individually selectable", () => {
    const rows = groupRows([
      call("1"),
      call("2"),
      call("3"),
      { ...call("4"), label: "run_command", shape: "command" },
      { ...call("5"), label: "run_command", shape: "command" },
      { ...call("6"), label: "run_command", shape: "command" },
    ]);
    expect(rows).toHaveLength(4);
    const select = vi.fn();
    render(
      <TraceSurface>
        <TranscriptRow row={rows[0]!} onSelect={select} />
      </TraceSurface>,
    );
    fireEvent.click(screen.getByRole("button", { name: /read_file/ }));
    fireEvent.click(screen.getByRole("button", { name: /file-2.ts/ }));
    expect(select.mock.calls[0]?.[0].stepId).toBe("2");
  });
  it("attaches the portal before mounting content that manages focus", () => {
    const attached = vi.fn();
    function Probe() {
      const portal = useTracePortal();
      attached(portal && document.body.contains(portal));
      return null;
    }
    const mounted = render(
      <TraceSurface>
        <Probe />
      </TraceSurface>,
    );
    expect(attached).toHaveBeenCalledWith(true);
    expect(attached).not.toHaveBeenCalledWith(false);
    mounted.unmount();
    expect(document.querySelector(".trace-ui")).toBeNull();
  });
  it("opens the selected reply's trace, restores focus on Escape and aborts the stream", async () => {
    let streamSignal: AbortSignal | undefined;
    const data: TraceView = {
      summary: {
        schemaVersion: 1,
        traceId: "a".repeat(32),
        rootSpanId: "root",
        namespace: "project",
        sessionId: "session",
        agentId: "a",
        runId: "r",
        startedAtMs: 1000,
        lastOffsetMs: 25,
        durationMs: 25,
        runStatus: "completed",
        captureStatus: "complete",
        sessionPersistence: "saved",
        revision: 1,
        droppedEvents: 0,
        inputTokens: null,
        outputTokens: null,
        totalModelCalls: 1,
        meteredModelCalls: 0,
      },
      health: { persistence: "ready", droppedEvents: 0 },
      agentName: "AlphaCode",
      steps: [],
      lanes: null,
      searchScope: "input_and_output_preview",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if(path.includes('/by-reply')) {
          expect(path).toBe('/api/sessions/session/traces/by-reply?replyId=older%2Freply');
          return Response.json({traceId:data.summary.traceId});
        }
        if (path.endsWith("/events")) {
          streamSignal = options.signal as AbortSignal;
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"instanceId":"test","revision":1}\n\n',
                  ),
                );
                streamSignal?.addEventListener(
                  "abort",
                  () => controller.close(),
                  { once: true },
                );
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }
        return Response.json(data);
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const mounted = render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <TraceLauncher
            sessionId="session"
            replyId="older/reply"
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const trigger=screen.getByRole('button',{name:'执行记录'});
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(await screen.findByText("AlphaCode")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(`/api/sessions/session/traces/${data.summary.traceId}/view`,expect.anything());
    expect(screen.queryByText("上报用量")).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    mounted.unmount();
    expect(streamSignal?.aborted).toBe(true);
    client.clear();
  });
});

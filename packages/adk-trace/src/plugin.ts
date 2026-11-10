import type { Plugin } from "@alpha/adk/core";
import type { TraceScope } from "./contracts";
import type { TraceService } from "./service";
import { validateScope } from "./internal";

export function createTracePlugin<C = undefined>({
  service,
  scope,
}: {
  service: TraceService;
  scope: TraceScope;
}): Plugin<C> {
  validateScope(scope);
  const fixed = Object.freeze({ ...scope });
  let attached = false;
  return {
    id: "alpha/trace",
    apiVersion: 1,
    setup(api) {
      if (attached) throw new Error("TRACE_PLUGIN_ALREADY_BOUND");
      attached = true;
      api.observe((event) => {
        try {
          service.ingest(fixed, event);
        } catch {
          /* Trace is fail-open. */
        }
      });
    },
    // The application owns the service. Disposing one Agent never closes it.
  };
}

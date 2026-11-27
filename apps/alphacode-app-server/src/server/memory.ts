/** Minimal HTTP routes for enabling/disabling persistent Memory (no standalone Memory browser UI). */
import type { MemoryGlobalSettingsPatch } from "../global-config";
import type { MemoryService } from "../memory/service";
import { fail, jsonBody } from "./security";

export function createMemoryRoutes(options: {
  readonly service: MemoryService;
  readonly onChanged?: () => void;
}) {
  return async (request: Request, url: URL): Promise<Response> => {
    const path = url.pathname;
    if (path !== "/api/settings/memory") return fail(404, "NOT_FOUND");
    if (request.method === "GET") {
      return Response.json(await options.service.getSettings());
    }
    if (request.method === "PATCH") {
      const body = await jsonBody(request);
      const patch: MemoryGlobalSettingsPatch = {};
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") return fail(400, "INVALID_CONFIG");
        patch.enabled = body.enabled;
      }
      if (body.autoExtract !== undefined) {
        if (typeof body.autoExtract !== "boolean") return fail(400, "INVALID_CONFIG");
        patch.autoExtract = body.autoExtract;
      }
      if (body.autoDream !== undefined) {
        if (typeof body.autoDream !== "boolean") return fail(400, "INVALID_CONFIG");
        patch.autoDream = body.autoDream;
      }
      if (Object.keys(patch).length === 0) return fail(400, "INVALID_CONFIG");
      const updated = await options.service.updateSettings(patch);
      options.onChanged?.();
      return Response.json(updated);
    }
    return fail(405, "METHOD_NOT_ALLOWED");
  };
}

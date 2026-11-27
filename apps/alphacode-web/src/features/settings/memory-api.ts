import { SessionApiError } from "@/features/sessions/api";

export interface MemorySettingsView {
  enabled: boolean;
  autoExtract: boolean;
  autoDream: boolean;
  memoryDir: string;
}

export interface MemorySettingsPatch {
  enabled?: boolean;
  autoExtract?: boolean;
  autoDream?: boolean;
}

async function requestJson<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
  method = body === undefined ? "GET" : "PATCH",
): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as { code?: string };
    throw new SessionApiError(response.status, errorBody.code ?? `HTTP_${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new SessionApiError(response.status, "API_UNAVAILABLE");
  }
  return await response.json() as T;
}

export const memorySettingsQueryKey = ["settings", "memory"] as const;

export function getMemorySettings(signal: AbortSignal): Promise<MemorySettingsView> {
  return requestJson<MemorySettingsView>("/api/settings/memory", signal);
}

export function updateMemorySettings(patch: MemorySettingsPatch): Promise<MemorySettingsView> {
  return requestJson<MemorySettingsView>("/api/settings/memory", new AbortController().signal, patch, "PATCH");
}

import type { SessionData } from "@alpha/adk-session";
import type { PermissionMode } from "../chat/contracts";

export interface SessionSettings {
  readonly version: 1;
  readonly modelId: string;
  readonly permissionMode: PermissionMode;
}

export function settingsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "ask" || value === "auto" || value === "full";
}

export function readSessionSettings(data: SessionData): SessionSettings {
  const saved = data.metadata.alphacode;
  if (saved === undefined) {
    // Older AlphaCode archives encoded the model in their compatibility key.
    const modelId = data.agentKey.startsWith("alphacode-v1:") ? data.agentKey.slice("alphacode-v1:".length) : "";
    if (!modelId.trim()) throw settingsError("SESSION_SETTINGS_INVALID");
    return { version: 1, modelId, permissionMode: "ask" };
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw settingsError("SESSION_SETTINGS_INVALID");
  const value = saved as Record<string, unknown>;
  if (value.version !== 1 || typeof value.modelId !== "string" || !value.modelId.trim()
    || !isPermissionMode(value.permissionMode)) throw settingsError("SESSION_SETTINGS_INVALID");
  return { version: 1, modelId: value.modelId, permissionMode: value.permissionMode };
}

export function sameSettings(left: SessionSettings, right: SessionSettings): boolean {
  return left.modelId === right.modelId && left.permissionMode === right.permissionMode;
}

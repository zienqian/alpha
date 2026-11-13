import type { LanguagePreference, SkillsSettings } from "./global-config";
import type { PermissionMode } from "./chat/contracts";

export interface AppConfig {
  language?: LanguagePreference;
  skills?: SkillsSettings;
  workspaceRoot: string;
  projectName?: string;
  databasePath: string;
  modelId: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  autoCompact?: boolean;
  baseURL: string;
  apiKeyEnv: string;
  noAuth: boolean;
  sessionId?: string;
  permissionMode?: PermissionMode;
  configDirectory?: string;
  globalInstructions?: string;
  globalInstructionsPath?: string;
  traceEnabled?: boolean;
}

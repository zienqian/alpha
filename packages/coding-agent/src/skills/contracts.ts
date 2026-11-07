export interface SkillRoot {
  readonly path: string;
  readonly source: 'project' | 'user';
  readonly trusted: boolean;
}
export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly source: SkillRoot['source'];
  readonly revision: string;
  readonly argumentHint?: string;
  readonly disableModelInvocation: boolean;
  readonly userInvocable: boolean;
}
export interface SkillDiagnostic {
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly path: string;
  readonly name?: string;
  readonly field?: string;
}
export interface LoadSkillsOptions {
  readonly roots: readonly SkillRoot[];
  readonly disabledNames?: readonly string[];
  readonly reservedNames?: readonly string[];
  readonly signal?: AbortSignal;
}
export interface LoadSkillsResult {
  readonly skills: readonly SkillMetadata[];
  readonly diagnostics: readonly SkillDiagnostic[];
}
export interface SkillContent {
  readonly name: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly revision: string;
  readonly content: string;
}
export interface ReadSkillOptions { readonly signal?: AbortSignal; }

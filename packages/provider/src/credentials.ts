import { ProviderError } from './errors';
import type { AdapterContext, Credential } from './types';
import { isNonEmptyString } from './validation-helpers';

export function resolveCredential(value: Credential, getEnv: AdapterContext['getEnv']): string | undefined {
  if ('none' in value) return undefined;
  if ('value' in value) return value.value;
  let result: string | undefined;
  try {
    result = getEnv(value.env);
  } catch {
    throw new ProviderError('SECRET_MISSING', 'Unable to resolve provider credential.');
  }
  if (!isNonEmptyString(result)) throw new ProviderError('SECRET_MISSING', 'Provider credential is missing.');
  return result;
}

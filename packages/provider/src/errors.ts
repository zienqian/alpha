export type ProviderErrorCode = 'CONFIG_INVALID' | 'PROVIDER_NOT_FOUND' | 'MODEL_NOT_FOUND' | 'SECRET_MISSING' | 'ADAPTER_NOT_FOUND' | 'ADAPTER_INIT_FAILED' | 'REQUEST_FAILED' | 'RESPONSE_FAILED' | 'INVALID_RESPONSE' | 'INVALID_INPUT' | 'CONTEXT_LENGTH_EXCEEDED';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly path?: string;
  readonly status?: number;
  constructor(code: ProviderErrorCode, message: string, details?: { path?: string; status?: number }) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.path = details?.path;
    this.status = details?.status;
  }
}

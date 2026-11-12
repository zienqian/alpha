import { createClient } from "./transport";

export function createNativeClient(options: { origin: string; token: string }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(options.origin)) throw new Error("INVALID_LOCAL_ORIGIN");
  return createClient({ ...options, fetch: (url, init) => fetch(url, { ...init, proxy: false }) });
}

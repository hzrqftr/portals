/**
 * Thin fetch wrapper. Cloudflare Access handles authentication at the edge,
 * so there is no token to attach here and no login state to manage --
 * requests either arrive authenticated or never reach the Worker at all.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    ...(json !== undefined
      ? {
          body: JSON.stringify(json),
          headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
        }
      : {}),
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as { message?: string })?.message ?? `Request failed (${res.status})`,
      (body as { details?: unknown })?.details,
    );
  }
  return body as T;
}

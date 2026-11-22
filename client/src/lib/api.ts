export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path.startsWith("/") ? path : `/api/${path}`, {
    method: opts.method || (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.form ? undefined : opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || "Errore di rete");
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "POST", body: body ?? {} });
export const patch = <T = any>(p: string, body: unknown) => api<T>(p, { method: "PATCH", body });
export const put = <T = any>(p: string, body: unknown) => api<T>(p, { method: "PUT", body });
export const del = <T = any>(p: string) => api<T>(p, { method: "DELETE" });

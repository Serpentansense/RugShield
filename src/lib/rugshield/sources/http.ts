/**
 * Small fetch wrapper. Upstream failures are returned as values, never thrown,
 * so a single flaky API downgrades one check to `unavailable` instead of
 * failing the whole scan.
 */

export type Fetched<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number | null; body?: string };

export async function getJson<T>(
  url: string,
  timeoutMs: number,
): Promise<Fetched<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}`,
        body: text.slice(0, 500),
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as T, status: res.status };
    } catch {
      return {
        ok: false,
        status: res.status,
        error: 'Upstream returned a non-JSON body',
        body: text.slice(0, 200),
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: null,
      error: controller.signal.aborted ? `Timed out after ${timeoutMs}ms` : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Shared API base + fetch helpers for talking to the NestJS backend.
// Server components use plain fetch (see below); client components that
// need an authenticated call use apiFetchWithAuth from lib/api-client.ts.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function serverFetch<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      next: { revalidate: 300, ...(opts as any)?.next },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null; // backend unreachable — callers render a graceful fallback
  }
}

"use client";

import { useAuth } from "@clerk/nextjs";
import { API_URL } from "./api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Client-side hook for authenticated calls to the backend. Attaches the
 * current Clerk session token as a Bearer header — ClerkAuthGuard on the
 * backend verifies it and resolves it to the local User row.
 */
export function useApiClient() {
  const { getToken } = useAuth();

  async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body?.message || `Request failed (${res.status})`, res.status);
    }
    return res.json();
  }

  return { apiFetch };
}

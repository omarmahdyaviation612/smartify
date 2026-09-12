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

  async function rawFetch(path: string, opts: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    // FormData (file uploads) must NOT get a manual Content-Type — the
    // browser sets its own multipart boundary. Only default to JSON when
    // the caller isn't sending FormData.
    const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body?.message || `Request failed (${res.status})`, res.status);
    }
    return res;
  }

  async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await rawFetch(path, opts);
    return res.json();
  }

  /** For binary responses (e.g. an admin-gated receipt image) — never a plain <img src> to a bare URL. */
  async function apiFetchBlob(path: string, opts: RequestInit = {}): Promise<Blob> {
    const res = await rawFetch(path, opts);
    return res.blob();
  }

  return { apiFetch, apiFetchBlob };
}

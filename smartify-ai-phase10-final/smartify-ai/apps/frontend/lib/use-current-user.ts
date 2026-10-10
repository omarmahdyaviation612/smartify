"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useApiClient } from "./api-client";

interface CurrentUser {
  id: string;
  email: string;
  role: string;
  /** False until onboarding's grade & subjects step saves the StudentProfile. */
  hasStudentProfile?: boolean;
}

/**
 * Client-side convenience only — lets admin pages show/hide sections and
 * a friendly "not authorized" message without a flash of admin content.
 * This is NOT the security boundary: every /admin/* backend endpoint
 * re-checks the role itself via RolesGuard regardless of what this hook
 * returns, per the Phase 2 backend-owned-authorization decision.
 */
export function useCurrentUser() {
  const { isSignedIn, isLoaded } = useAuth();
  const { apiFetch } = useApiClient();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setUser(null);
      setLoading(false);
      return;
    }
    apiFetch<CurrentUser>("/users/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  return { user, loading };
}

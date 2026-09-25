"use client";

import { useEffect, useRef, useState } from "react";
import { useApiClient } from "@/lib/api-client";

interface SchoolResult {
  id: string;
  nameEn: string;
  nameAr: string | null;
  governorate: string;
  area: string | null;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

/**
 * Searchable school combobox for the onboarding profile step. Queries
 * GET /schools?governorate=&q= — debounced and gated on a minimum useful
 * query length so it never fires a request per keystroke. Only enabled
 * once a governorate is chosen (the backend requires it).
 */
export function SchoolCombobox({
  locale,
  governorate,
  value,
  onSelect,
  placeholder,
  noResultsLabel,
}: {
  locale: "ar" | "en";
  governorate: string;
  value: { id: string; label: string } | null;
  onSelect: (school: { id: string; label: string } | null) => void;
  placeholder: string;
  noResultsLabel: string;
}) {
  const isAr = locale === "ar";
  const { apiFetch } = useApiClient();
  const [query, setQuery] = useState(value?.label ?? "");
  const [results, setResults] = useState<SchoolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setQuery(value?.label ?? "");
  }, [value?.id]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!governorate || trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      const params = new URLSearchParams({ governorate, q: trimmed });
      apiFetch<SchoolResult[]>(`/schools?${params.toString()}`)
        .then((data) => {
          if (requestId === requestIdRef.current) setResults(data);
        })
        .catch(() => {
          if (requestId === requestIdRef.current) setResults([]);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, governorate]);

  return (
    <div className="relative">
      <input
        value={query}
        disabled={!governorate}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full rounded-sf border border-neutral-300 px-4 py-2 disabled:bg-neutral-100"
      />
      {open && query.trim().length >= MIN_QUERY_LENGTH && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-sf border border-neutral-200 bg-white shadow-lg">
          {loading && <p className="px-4 py-2 text-sm text-neutral-500">…</p>}
          {!loading && results.length === 0 && (
            <p className="px-4 py-2 text-sm text-neutral-500">{noResultsLabel}</p>
          )}
          {!loading &&
            results.map((school) => (
              <button
                key={school.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const label = isAr && school.nameAr ? school.nameAr : school.nameEn;
                  setQuery(label);
                  setOpen(false);
                  onSelect({ id: school.id, label });
                }}
                className="block w-full px-4 py-2 text-start text-sm hover:bg-neutral-50"
              >
                {isAr && school.nameAr ? school.nameAr : school.nameEn}
                {school.area && <span className="ms-2 text-xs text-neutral-400">{school.area}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

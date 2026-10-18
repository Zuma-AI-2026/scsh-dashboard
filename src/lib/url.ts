/** Build a same-page href from current search params plus overrides (undefined/"" removes a key). */
export function hrefWith(pathname: string, current: Record<string, string | undefined>, overrides: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...overrides })) {
    if (v !== undefined && v !== "") sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Collapse Next's searchParams (string | string[] | undefined) to single strings. */
export function flattenParams(raw: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

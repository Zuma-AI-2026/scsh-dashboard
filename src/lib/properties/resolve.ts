/**
 * Free text → managed property, for n8n (GET /api/properties/resolve).
 * Pure; no imports, so `node --test` can load it (tests/property-resolve.test.mts).
 *
 * Address match: the query's house number must fall in the property's number
 * (or number range, e.g. "2644 - 2646"), then the street-name tokens are
 * compared. Direction (W/West) and street type (St/Street, Pl/Place, Ave/Avenue…)
 * are normalized; a conflicting type or direction is penalized, because
 * "1340 W 37th St" and "1340 W 37th Place" are different buildings. Unit
 * suffixes ("Unit 101", "Apt 3", "#5") and city/state/zip tails are ignored.
 * Name match: every word of the property's name (e.g. "Dee Jay and The Joint").
 */

export type ResolvableProperty = {
  property_id: number;
  property_integration_id: string | null;
  property_name: string | null;
  property_street: string | null;
  property_street2: string | null;
};

export type Resolution<P extends ResolvableProperty = ResolvableProperty> =
  | { kind: "match"; property: P; confidence: number }
  | { kind: "ambiguous"; candidates: { property: P; confidence: number }[] }
  | { kind: "none"; best: { property: P; confidence: number } | null };

export const MATCH_THRESHOLD = 0.75;
/** A runner-up this close to the best (and above the threshold) makes the answer ambiguous. */
const AMBIGUITY_GAP = 0.05;

const DIRECTIONS: Record<string, string> = { w: "w", west: "w", e: "e", east: "e", n: "n", north: "n", s: "s", south: "s" };
const STREET_TYPES: Record<string, string> = {
  st: "st", str: "st", street: "st",
  pl: "pl", place: "pl",
  ave: "ave", av: "ave", avenue: "ave",
  blvd: "blvd", boulevard: "blvd",
  dr: "dr", drive: "dr",
  rd: "rd", road: "rd",
  ln: "ln", lane: "ln",
  ct: "ct", court: "ct",
  ter: "ter", terrace: "ter",
  way: "way",
};
const NAME_STOPWORDS = new Set(["the", "on", "at", "of", "and", "a", "an", "llc", "inc", "apartments", "apartment", "apts"]);

function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ") // "1/2"
    .replace(/(?:#|\b(?:unit|apt|apartment|suite|ste|room|rm|bldg|building)\b\.?)\s*[a-z0-9-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const norm = (t: string) => DIRECTIONS[t] ?? STREET_TYPES[t] ?? t;
const tokens = (s: string) => clean(s).split(" ").filter(Boolean).map(norm);

type AddressParts = { numbers: Set<number>; core: string[]; type: string | null; dir: string | null };

/** "2644 - 2646 Ellendale Pl" → numbers {2644, 2645, 2646}, core [ellendale], type pl. */
function parseAddress(text: string): AddressParts | null {
  const street = text.split(",")[0].toLowerCase().replace(/\b\d+\s*\/\s*\d+\b/g, " ");
  const m = street.match(/^\s*(\d+)(?:\s*[-–]\s*(\d+))?/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  const numbers = new Set<number>([lo]);
  if (hi > lo && hi - lo <= 10) for (let n = lo + 1; n <= hi; n++) numbers.add(n);
  else if (hi !== lo) numbers.add(hi);

  const rest = tokens(street.slice(m[0].length));
  let type: string | null = null;
  let dir: string | null = null;
  const core: string[] = [];
  for (const t of rest) {
    if (Object.values(STREET_TYPES).includes(t)) type = t;
    else if (Object.values(DIRECTIONS).includes(t) && !dir && core.length === 0) dir = t;
    else if (!/^\d+$/.test(t)) core.push(t);
  }
  return { numbers, core, type, dir };
}

type Query = { number: number | null; tokens: Set<string>; type: string | null; dir: string | null };

function parseQuery(q: string): Query {
  const t = tokens(q.split(",")[0]);
  const all = new Set(tokens(q));
  const first = t[0] && /^\d+$/.test(t[0]) ? Number(t[0]) : null;
  const street = first === null ? t : t.slice(1);
  let type: string | null = null;
  let dir: string | null = null;
  for (const x of street) {
    if (Object.values(STREET_TYPES).includes(x)) type ??= x;
    else if (Object.values(DIRECTIONS).includes(x) && street.indexOf(x) === 0) dir = x;
  }
  return { number: first, tokens: all, type, dir };
}

function addressScore(q: Query, a: AddressParts): number {
  if (q.number === null || !a.numbers.has(q.number) || a.core.length === 0) return 0;
  const hit = a.core.filter((t) => q.tokens.has(t)).length / a.core.length;
  if (hit === 0) return 0.3;
  let score = 0.55 + 0.35 * hit;
  if (q.type && a.type) score += q.type === a.type ? 0.1 : -0.25;
  if (q.dir && a.dir && q.dir !== a.dir) score -= 0.25;
  return score;
}

function nameScore(q: Query, name: string): number {
  if (/^\s*\d/.test(name)) return 0; // address-like names are scored as addresses
  const words = clean(name).split(" ").filter((w) => w && !NAME_STOPWORDS.has(w));
  if (words.length === 0) return 0;
  const raw = new Set(clean([...q.tokens].join(" ")).split(" "));
  const hit = words.filter((w) => raw.has(w) || q.tokens.has(norm(w))).length / words.length;
  return hit === 1 ? 0.9 : 0.6 * hit;
}

export function scoreProperty(query: string, p: ResolvableProperty): number {
  const q = parseQuery(query);
  const variants = [[p.property_street, p.property_street2].filter(Boolean).join(" "), p.property_name ?? ""];
  let best = 0;
  for (const v of variants) {
    const a = v ? parseAddress(v) : null;
    if (a) best = Math.max(best, addressScore(q, a));
  }
  if (p.property_name) best = Math.max(best, nameScore(q, p.property_name));
  return Math.round(Math.min(best, 1) * 100) / 100;
}

export function resolveProperty<P extends ResolvableProperty>(query: string, properties: P[]): Resolution<P> {
  const scored = properties
    .map((property) => ({ property, confidence: scoreProperty(query, property) }))
    .filter((s) => s.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || a.property.property_id - b.property.property_id);
  const best = scored[0];
  if (!best || best.confidence < MATCH_THRESHOLD) return { kind: "none", best: best ?? null };
  const close = scored.filter((s) => s.confidence >= MATCH_THRESHOLD && best.confidence - s.confidence <= AMBIGUITY_GAP);
  return close.length > 1 ? { kind: "ambiguous", candidates: close } : { kind: "match", ...best };
}

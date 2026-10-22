/**
 * The Supabase API returns at most 1,000 rows per request (project "Max rows"
 * setting), whatever .limit() asks for. Page through with .range() instead.
 * `page(from, to)` must apply a stable order (end with a unique column).
 */
const PAGE = 1000;
const MAX_PAGES = 100;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(label: string, page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, (i + 1) * PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(`${label}: more than ${PAGE * MAX_PAGES} rows`);
}

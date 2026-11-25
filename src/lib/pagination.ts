/** Read all matching records in stable order, not just the API's first page. */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  size = 500,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += size) {
    const result = await page(from, from + size - 1);
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    all.push(...rows);
    if (rows.length < size) return all;
  }
}

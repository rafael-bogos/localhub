/**
 * Runs one action over many items in parallel and never throws: it returns
 * a short message describing the failures, or '' when everything worked.
 */
export async function runBatch<T>(
    items: T[],
    action: (item: T) => Promise<unknown>,
    labelOf: (item: T) => string
): Promise<string> {
    const results = await Promise.allSettled(items.map(action));
    const failed = results
        .map((r, i) => (r.status === 'rejected' ? `${labelOf(items[i])} (${String(r.reason)})` : ''))
        .filter(Boolean);
    if (failed.length === 0) return '';
    return `Falhou em ${failed.length} de ${items.length}: ${failed.join('; ')}`;
}

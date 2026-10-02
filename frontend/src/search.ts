/**
 * Whether every word of the query appears in at least one of the fields
 * (case-insensitive). So "redis alpine" finds a container by its name and its
 * image together, and an ID can be typed whole or in part.
 */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = fields.filter((f): f is string => Boolean(f)).map((f) => f.toLowerCase());
    return terms.every((t) => haystack.some((f) => f.includes(t)));
}

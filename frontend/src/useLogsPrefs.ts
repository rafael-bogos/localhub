import { useCallback, useEffect, useRef, useState } from 'react';
import { LEVELS, type Level } from './logLevel';

// Bump the version in the key when the shape changes: an old or corrupted
// value is then ignored and the defaults apply.
const STORAGE_KEY = 'localhub.logs.v1';
const SAVE_DELAY_MS = 300;

export const MIN_WIDTH = 320;

export type SearchMode = 'filtrar' | 'destacar';
export type Period = 'all' | '5m' | '1h';

export interface LogsPrefs {
    width: number;
    expanded: boolean;
    mode: SearchMode;
    regex: boolean;
    query: string;
    sources: { stdout: boolean; stderr: boolean };
    levels: Record<Level, boolean>;
    period: Period;
    follow: boolean;
    /** Name (not id, which changes when a container is recreated) of the container left open. */
    container: string | null;
}

export const DEFAULT_PREFS: LogsPrefs = {
    width: 460,
    expanded: false,
    mode: 'filtrar',
    regex: false,
    query: '',
    sources: { stdout: true, stderr: true },
    levels: { erro: true, aviso: true, info: true, debug: true, outros: true },
    period: 'all',
    follow: true,
    container: null,
};

/** Search or any filter differs from its default. */
export function isFiltering(p: LogsPrefs): boolean {
    return (
        p.query !== '' ||
        !p.sources.stdout ||
        !p.sources.stderr ||
        LEVELS.some((l) => !p.levels[l]) ||
        p.period !== 'all'
    );
}

/** The filter fields reset by "Limpar filtros". */
export const CLEARED_FILTERS: Pick<LogsPrefs, 'query' | 'sources' | 'levels' | 'period'> = {
    query: DEFAULT_PREFS.query,
    sources: DEFAULT_PREFS.sources,
    levels: DEFAULT_PREFS.levels,
    period: DEFAULT_PREFS.period,
};

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function load(): LogsPrefs {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_PREFS;
        const v = JSON.parse(raw) as Record<string, any>;
        if (!v || typeof v !== 'object') return DEFAULT_PREFS;

        const levels = { ...DEFAULT_PREFS.levels };
        for (const l of LEVELS) levels[l] = bool(v.levels?.[l], true);

        return {
            width: typeof v.width === 'number' && v.width >= MIN_WIDTH ? Math.round(v.width) : DEFAULT_PREFS.width,
            expanded: bool(v.expanded, DEFAULT_PREFS.expanded),
            mode: v.mode === 'destacar' ? 'destacar' : 'filtrar',
            regex: bool(v.regex, DEFAULT_PREFS.regex),
            query: typeof v.query === 'string' ? v.query.slice(0, 500) : '',
            sources: {
                stdout: bool(v.sources?.stdout, true),
                stderr: bool(v.sources?.stderr, true),
            },
            levels,
            period: v.period === '5m' || v.period === '1h' ? v.period : 'all',
            follow: bool(v.follow, DEFAULT_PREFS.follow),
            container: typeof v.container === 'string' && v.container ? v.container : null,
        };
    } catch {
        return DEFAULT_PREFS;
    }
}

function save(prefs: LogsPrefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Storage unavailable (private mode, blocked): prefs just won't persist.
    }
}

/** A patch, or a function of the latest prefs (safe for several updates in one event). */
export type PrefsPatch = Partial<LogsPrefs> | ((prev: LogsPrefs) => Partial<LogsPrefs>);

export function useLogsPrefs(): [LogsPrefs, (patch: PrefsPatch) => void] {
    const [prefs, setPrefs] = useState<LogsPrefs>(load);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latest = useRef(prefs);
    latest.current = prefs;

    const update = useCallback((patch: PrefsPatch) => {
        setPrefs((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
    }, []);

    // Debounced so typing in the search box or dragging the width doesn't
    // write on every keystroke/pixel.
    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => save(prefs), SAVE_DELAY_MS);
        return () => clearTimeout(timer.current);
    }, [prefs]);

    // Flush a pending write when the window closes.
    useEffect(() => {
        const onHide = () => save(latest.current);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('beforeunload', onHide);
        return () => {
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('beforeunload', onHide);
        };
    }, []);

    return [prefs, update];
}

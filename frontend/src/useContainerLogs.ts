import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ListContainers,
    LoadOlderContainerLogs,
    StartContainerLogs,
    StopContainerLogs,
} from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { levelFor, newLevelMemory, type Level, type LevelMemory, type StreamName } from './logLevel';

/** Most lines kept in memory; older ones are dropped as new ones arrive. */
export const MAX_LINES = 5000;
const INITIAL_TAIL = 500;
const OLDER_PAGE = 500;
const RECONNECT_POLL_MS = 4000;

export interface LogEntry {
    id: number;
    ts: string;
    tsMs: number | null;
    clock: string;
    stream: StreamName;
    text: string;
    level: Level;
}

interface RawLine {
    ts: string;
    stream: string;
    text: string;
}

export type LogsState = 'loading' | 'live' | 'ended' | 'error';

export interface LogsEnd {
    reason: 'stopped' | 'removed' | 'error';
    message: string;
}

let nextId = 1;

// Docker timestamps carry nanoseconds; Date.parse is only guaranteed for
// milliseconds, so the fraction is cut to 3 digits first.
function parseTs(ts: string): number | null {
    if (!ts) return null;
    const ms = Date.parse(ts.replace(/(\.\d{3})\d+/, '$1'));
    return Number.isNaN(ms) ? null : ms;
}

function pad(n: number, len = 2): string {
    return String(n).padStart(len, '0');
}

function clockOf(ms: number | null): string {
    if (ms === null) return '';
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function annotate(raw: RawLine[], memory: LevelMemory): LogEntry[] {
    return raw.map((r) => {
        const stream: StreamName = r.stream === 'stderr' ? 'stderr' : 'stdout';
        const tsMs = parseTs(r.ts);
        return {
            id: nextId++,
            ts: r.ts,
            tsMs,
            clock: clockOf(tsMs),
            stream,
            text: r.text,
            level: levelFor(r.text, stream, memory),
        };
    });
}

function newSessionId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s${Date.now()}${Math.random().toString(16).slice(2)}`;
}

export interface ContainerLogs {
    lines: LogEntry[];
    state: LogsState;
    end: LogsEnd | null;
    error: string;
    /** Display frozen by the user; lines keep arriving and wait in `pendingCount`. */
    frozen: boolean;
    setFrozen: (frozen: boolean) => void;
    pendingCount: number;
    /** Old lines were dropped to respect MAX_LINES. */
    dropped: boolean;
    canLoadOlder: boolean;
    /** Every older line has been loaded (or the screen was cleared). */
    historyEnded: boolean;
    loadingOlder: boolean;
    /** Prepends the previous page of history to `lines`. */
    loadOlder: () => Promise<void>;
    clear: () => void;
}

export function useContainerLogs(containerId: string | null): ContainerLogs {
    const [lines, setLines] = useState<LogEntry[]>([]);
    const [state, setState] = useState<LogsState>('loading');
    const [end, setEnd] = useState<LogsEnd | null>(null);
    const [error, setError] = useState('');
    const [frozen, setFrozenState] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [dropped, setDropped] = useState(false);
    const [historyEnded, setHistoryEnded] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [restartKey, setRestartKey] = useState(0);

    const pending = useRef<LogEntry[]>([]);
    const frame = useRef<number | null>(null);
    const frozenRef = useRef(false);
    const memory = useRef<LevelMemory>(newLevelMemory());
    const linesRef = useRef<LogEntry[]>([]);
    linesRef.current = lines;

    const flush = useCallback(() => {
        frame.current = null;
        if (frozenRef.current || pending.current.length === 0) return;
        const incoming = pending.current;
        pending.current = [];
        setLines((prev) => {
            const merged = prev.concat(incoming);
            if (merged.length > MAX_LINES) {
                setDropped(true);
                return merged.slice(merged.length - MAX_LINES);
            }
            return merged;
        });
    }, []);

    const schedule = useCallback(() => {
        if (frame.current === null) {
            frame.current = requestAnimationFrame(flush);
        }
    }, [flush]);

    const setFrozen = useCallback(
        (value: boolean) => {
            frozenRef.current = value;
            setFrozenState(value);
            if (!value) {
                setPendingCount(0);
                schedule();
            }
        },
        [schedule]
    );

    const clear = useCallback(() => {
        pending.current = [];
        setPendingCount(0);
        setLines([]);
        setDropped(false);
        // Cleared means "start fresh from now": nothing older to load.
        setHistoryEnded(true);
    }, []);

    // One stream per open container. Restarting (container came back) reuses
    // the same effect through restartKey.
    useEffect(() => {
        pending.current = [];
        memory.current = newLevelMemory();
        frozenRef.current = false;
        setFrozenState(false);
        setPendingCount(0);
        setLines([]);
        setState('loading');
        setEnd(null);
        setError('');
        setDropped(false);
        setHistoryEnded(false);

        if (!containerId) return;

        const sessionId = newSessionId();
        let cancelled = false;

        const offBatch = EventsOn(`logs:batch:${sessionId}`, (batch: RawLine[]) => {
            if (cancelled || !Array.isArray(batch)) return;
            pending.current.push(...annotate(batch, memory.current));
            if (frozenRef.current) {
                setPendingCount(pending.current.length);
            } else {
                schedule();
            }
        });
        const offEnd = EventsOn(`logs:end:${sessionId}`, (info: LogsEnd) => {
            if (cancelled) return;
            // Let the last batch land first: it was emitted before this event.
            setTimeout(() => {
                if (cancelled) return;
                setEnd(info);
                setState('ended');
            }, 150);
        });

        StartContainerLogs(sessionId, containerId, INITIAL_TAIL)
            .then(() => {
                if (cancelled) {
                    StopContainerLogs(sessionId);
                    return;
                }
                setState((s) => (s === 'loading' ? 'live' : s));
            })
            .catch((err) => {
                if (cancelled) return;
                setError(String(err));
                setState('error');
            });

        return () => {
            cancelled = true;
            offBatch();
            offEnd();
            StopContainerLogs(sessionId);
            if (frame.current !== null) {
                cancelAnimationFrame(frame.current);
                frame.current = null;
            }
        };
    }, [containerId, restartKey, schedule]);

    // A stopped container that is started again while its panel is open
    // reconnects on its own.
    useEffect(() => {
        if (!containerId || state !== 'ended' || end?.reason !== 'stopped') return;
        let cancelled = false;
        const timer = setInterval(async () => {
            try {
                const all = await ListContainers();
                if (!cancelled && all.some((c) => c.id === containerId && c.state === 'running')) {
                    setRestartKey((k) => k + 1);
                }
            } catch {
                // Docker unreachable: keep waiting.
            }
        }, RECONNECT_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [containerId, state, end]);

    const loadOlder = useCallback(async () => {
        const current = linesRef.current;
        const oldest = current.find((l) => l.ts);
        if (!containerId || !oldest || loadingOlder || current.length >= MAX_LINES) return;

        setLoadingOlder(true);
        try {
            const result = await LoadOlderContainerLogs(containerId, oldest.ts, OLDER_PAGE);
            const room = MAX_LINES - linesRef.current.length;
            const older = annotate(result.lines ?? [], newLevelMemory()).slice(-room);
            if (older.length > 0) {
                setLines((prev) => older.concat(prev));
            }
            if (!result.hasMore) setHistoryEnded(true);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoadingOlder(false);
        }
    }, [containerId, loadingOlder]);

    return {
        lines,
        state,
        end,
        error,
        frozen,
        setFrozen,
        pendingCount,
        dropped,
        historyEnded,
        canLoadOlder: !historyEnded && lines.some((l) => l.ts) && lines.length < MAX_LINES,
        loadingOlder,
        loadOlder,
        clear,
    };
}

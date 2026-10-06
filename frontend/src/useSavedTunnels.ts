import { useCallback, useEffect, useRef, useState } from 'react';

// Tunnels the user defines for a server (a local port that leads to a host and
// port reachable from that server). Only the definition is saved; whether one
// is open comes from the backend. Bump the version when the shape changes.
const STORAGE_KEY = 'localhub.tunnels.v1';
const SAVE_DELAY_MS = 300;

export interface SavedTunnel {
    id: string;
    hostId: string;
    name: string;
    /** Port on this computer (127.0.0.1) that clients connect to. */
    localPort: number;
    /** IP or host name, as the server sees it (a private address, for instance). */
    remoteHost: string;
    remotePort: number;
    /** Open it by itself every time the server connects. */
    autoOpen: boolean;
}

export type SavedTunnelDraft = Omit<SavedTunnel, 'id'>;

function newId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function port(v: unknown): number | null {
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535 ? v : null;
}

export function normalizeTunnel(raw: unknown, withId: boolean): SavedTunnel | null {
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Record<string, unknown>;
    const hostId = typeof v.hostId === 'string' ? v.hostId : '';
    const remoteHost = typeof v.remoteHost === 'string' ? v.remoteHost.trim().slice(0, 253) : '';
    const localPort = port(v.localPort);
    const remotePort = port(v.remotePort);
    if (!hostId || !remoteHost || localPort === null || remotePort === null) return null;
    const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : `${remoteHost}:${remotePort}`;
    return {
        id: withId && typeof v.id === 'string' && v.id ? v.id : newId(),
        hostId,
        name,
        localPort,
        remoteHost,
        remotePort,
        autoOpen: v.autoOpen === true,
    };
}

function load(): SavedTunnel[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
        if (!Array.isArray(parsed)) return [];
        const seen = new Set<string>();
        const list: SavedTunnel[] = [];
        for (const item of parsed) {
            const t = normalizeTunnel(item, true);
            if (t && !seen.has(t.id)) {
                seen.add(t.id);
                list.push(t);
            }
        }
        return list;
    } catch {
        return [];
    }
}

function save(list: SavedTunnel[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        // Storage unavailable: the tunnels just won't persist.
    }
}

export interface SavedTunnelsApi {
    saved: SavedTunnel[];
    add: (draft: SavedTunnelDraft) => SavedTunnel | null;
    update: (id: string, draft: SavedTunnelDraft) => void;
    remove: (id: string) => void;
}

/** The saved tunnels. Those of servers that no longer exist are dropped. */
export function useSavedTunnels(hostIds: string[]): SavedTunnelsApi {
    const [saved, setSaved] = useState<SavedTunnel[]>(load);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latest = useRef(saved);
    latest.current = saved;

    const add = useCallback((draft: SavedTunnelDraft) => {
        const t = normalizeTunnel(draft, false);
        if (t) setSaved((prev) => [...prev, t]);
        return t;
    }, []);
    const update = useCallback((id: string, draft: SavedTunnelDraft) => {
        const t = normalizeTunnel({ ...draft, id }, true);
        if (t) setSaved((prev) => prev.map((x) => (x.id === id ? t : x)));
    }, []);
    const remove = useCallback((id: string) => setSaved((prev) => prev.filter((x) => x.id !== id)), []);

    const hostKey = hostIds.join('|');
    useEffect(() => {
        const ids = new Set(hostKey ? hostKey.split('|') : []);
        setSaved((prev) => (prev.every((t) => ids.has(t.hostId)) ? prev : prev.filter((t) => ids.has(t.hostId))));
    }, [hostKey]);

    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => save(saved), SAVE_DELAY_MS);
        return () => clearTimeout(timer.current);
    }, [saved]);

    useEffect(() => {
        const onHide = () => save(latest.current);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('beforeunload', onHide);
        return () => {
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('beforeunload', onHide);
        };
    }, []);

    return { saved, add, update, remove };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { readConfig, writeConfig } from './appConfig';

// Stored in the settings file under this key. If the shape ever changes
// incompatibly, use a new key (and migrate): an unreadable value is ignored and
// the list starts empty.
const STORAGE_KEY = 'ssh';
const SAVE_DELAY_MS = 100;

export type SshMethod = 'key' | 'agent';

/**
 * A saved server. Metadata only: passphrases and key contents are never
 * stored here (only the path of the key file).
 */
export interface SshHost {
    id: string;
    name: string;
    address: string;
    port: number;
    user: string;
    method: SshMethod;
    keyPath: string;
}

export type SshHostDraft = Omit<SshHost, 'id'>;

export const DEFAULT_PORT = 22;

function newId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function str(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Validates one stored/imported entry; returns null when it is unusable. */
function normalize(raw: unknown, withId: boolean): SshHost | null {
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Record<string, unknown>;

    const address = str(v.address, 255);
    const user = str(v.user, 128);
    if (!address || !user) return null;

    const method: SshMethod = v.method === 'agent' ? 'agent' : 'key';
    const keyPath = method === 'key' ? str(v.keyPath, 1024) : '';
    const port = typeof v.port === 'number' && Number.isInteger(v.port) && v.port >= 1 && v.port <= 65535 ? v.port : DEFAULT_PORT;
    const id = withId && typeof v.id === 'string' && v.id ? v.id : newId();

    return { id, name: str(v.name, 80) || address, address, port, user, method, keyPath };
}

function load(): SshHost[] {
    try {
        const parsed = readConfig(STORAGE_KEY);
        if (!Array.isArray(parsed)) return [];
        const seen = new Set<string>();
        const hosts: SshHost[] = [];
        for (const item of parsed) {
            const h = normalize(item, true);
            if (h && !seen.has(h.id)) {
                seen.add(h.id);
                hosts.push(h);
            }
        }
        return hosts;
    } catch {
        return [];
    }
}

function save(hosts: SshHost[]) {
    writeConfig(STORAGE_KEY, hosts);
}

/** Same machine, port and login: what makes an imported entry a duplicate. */
export function hostKey(h: Pick<SshHost, 'address' | 'port' | 'user'>): string {
    return `${h.user}@${h.address.toLowerCase()}:${h.port}`;
}

export interface SshHostsApi {
    hosts: SshHost[];
    add: (draft: SshHostDraft) => SshHost | null;
    update: (id: string, draft: SshHostDraft) => void;
    remove: (id: string) => void;
    /** Adds the entries that are not already saved; returns how many were added. */
    addMany: (drafts: SshHostDraft[]) => number;
}

export function useSshHosts(): SshHostsApi {
    const [hosts, setHosts] = useState<SshHost[]>(load);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latest = useRef(hosts);
    latest.current = hosts;

    const add = useCallback((draft: SshHostDraft) => {
        const host = normalize(draft, false);
        if (host) setHosts((prev) => [...prev, host]);
        return host;
    }, []);

    const update = useCallback((id: string, draft: SshHostDraft) => {
        const next = normalize({ ...draft, id }, true);
        if (next) setHosts((prev) => prev.map((h) => (h.id === id ? next : h)));
    }, []);

    const remove = useCallback((id: string) => {
        setHosts((prev) => prev.filter((h) => h.id !== id));
    }, []);

    const addMany = useCallback((drafts: SshHostDraft[]) => {
        // Computed from the latest list (not inside the updater) so the count
        // can be returned synchronously.
        const known = new Set(latest.current.map(hostKey));
        const fresh: SshHost[] = [];
        for (const d of drafts) {
            const h = normalize(d, false);
            if (h && !known.has(hostKey(h))) {
                known.add(hostKey(h));
                fresh.push(h);
            }
        }
        if (fresh.length) setHosts((prev) => [...prev, ...fresh]);
        return fresh.length;
    }, []);

    // Debounced so typing in the form never writes on every keystroke.
    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => save(hosts), SAVE_DELAY_MS);
        return () => clearTimeout(timer.current);
    }, [hosts]);

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

    return { hosts, add, update, remove, addMany };
}

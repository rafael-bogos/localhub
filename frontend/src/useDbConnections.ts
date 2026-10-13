import { useCallback, useEffect, useRef, useState } from 'react';
import { readConfig, writeConfig } from './appConfig';

// Stored in the settings file under this key. An unreadable value is ignored
// and the list starts empty.
const STORAGE_KEY = 'databases';
const SAVE_DELAY_MS = 100;

export type DbKind = 'postgres' | 'mysql';
export type DbSsl = 'off' | 'require';

/**
 * A saved database connection. The password is stored in the settings file as
 * plain text (the file is private to the user, like the SSH key paths), which
 * the form says out loud.
 */
export interface DbProfile {
    id: string;
    name: string;
    kind: DbKind;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: DbSsl;
    readOnly: boolean;
    /**
     * Set when the connection was made from a container: hostId is the server
     * ("" for this machine) and container the container's name. Opening it
     * again re-reads where the container is reachable (a tunnel's port changes
     * between sessions).
     */
    origin?: DbOrigin;
}

export interface DbOrigin {
    hostId: string;
    container: string;
}

export type DbProfileDraft = Omit<DbProfile, 'id'>;

export const DB_KIND_LABEL: Record<DbKind, string> = { postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB' };

export function defaultPort(kind: DbKind): number {
    return kind === 'mysql' ? 3306 : 5432;
}

function newId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function str(value: unknown, max: number): string {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

function normalize(raw: unknown, withId: boolean): DbProfile | null {
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Record<string, unknown>;
    const kind: DbKind = v.kind === 'mysql' ? 'mysql' : 'postgres';
    const host = str(v.host, 255).trim();
    const database = str(v.database, 128).trim();
    const user = str(v.user, 128).trim();
    if (!host || !database || !user) return null;
    const port = typeof v.port === 'number' && Number.isInteger(v.port) && v.port >= 1 && v.port <= 65535 ? v.port : defaultPort(kind);
    const id = withId && typeof v.id === 'string' && v.id ? v.id : newId();
    return {
        id,
        name: str(v.name, 80).trim() || `${database}@${host}`,
        kind,
        host,
        port,
        database,
        user,
        password: str(v.password, 512),
        ssl: v.ssl === 'require' ? 'require' : 'off',
        readOnly: v.readOnly === true,
        origin: normalizeOrigin(v.origin),
    };
}

function normalizeOrigin(raw: unknown): DbOrigin | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    const container = str(o.container, 255).trim();
    return container ? { hostId: str(o.hostId, 128), container } : undefined;
}

function load(): DbProfile[] {
    try {
        const parsed = readConfig(STORAGE_KEY);
        if (!Array.isArray(parsed)) return [];
        const seen = new Set<string>();
        const list: DbProfile[] = [];
        for (const item of parsed) {
            const p = normalize(item, true);
            if (p && !seen.has(p.id)) {
                seen.add(p.id);
                list.push(p);
            }
        }
        return list;
    } catch {
        return [];
    }
}

export interface DbConnectionsApi {
    profiles: DbProfile[];
    add: (draft: DbProfileDraft) => DbProfile | null;
    update: (id: string, draft: DbProfileDraft) => void;
    remove: (id: string) => void;
    /**
     * Saves the connection of a container, or refreshes where an existing one
     * reaches it (host and port only: what the user edited stays). Returns the
     * resulting profile.
     */
    upsertFromContainer: (origin: DbOrigin, found: DbProfileDraft) => DbProfile | null;
}

export function useDbConnections(): DbConnectionsApi {
    const [profiles, setProfiles] = useState<DbProfile[]>(load);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latest = useRef(profiles);
    latest.current = profiles;

    const add = useCallback((draft: DbProfileDraft) => {
        const p = normalize(draft, false);
        if (p) setProfiles((prev) => [...prev, p]);
        return p;
    }, []);

    const update = useCallback((id: string, draft: DbProfileDraft) => {
        const next = normalize({ ...draft, id }, true);
        if (next) setProfiles((prev) => prev.map((p) => (p.id === id ? next : p)));
    }, []);

    const remove = useCallback((id: string) => setProfiles((prev) => prev.filter((p) => p.id !== id)), []);

    const upsertFromContainer = useCallback((origin: DbOrigin, found: DbProfileDraft) => {
        const existing = latest.current.find((p) => p.origin?.hostId === origin.hostId && p.origin.container === origin.container);
        const next = existing
            ? normalize({ ...existing, host: found.host, port: found.port }, true)
            : normalize({ ...found, origin }, false);
        if (!next) return null;
        setProfiles((prev) => (existing ? prev.map((p) => (p.id === existing.id ? next : p)) : [...prev, next]));
        // Keep the ref current so a second call before the next render sees it.
        latest.current = existing ? latest.current.map((p) => (p.id === existing.id ? next : p)) : [...latest.current, next];
        return next;
    }, []);

    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => writeConfig(STORAGE_KEY, profiles), SAVE_DELAY_MS);
        return () => clearTimeout(timer.current);
    }, [profiles]);

    useEffect(() => {
        const onHide = () => writeConfig(STORAGE_KEY, latest.current);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('beforeunload', onHide);
        return () => {
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('beforeunload', onHide);
        };
    }, []);

    return { profiles, add, update, remove, upsertFromContainer };
}

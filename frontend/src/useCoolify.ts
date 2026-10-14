import { useCallback, useEffect, useRef, useState } from 'react';
import { readConfig, writeConfig } from './appConfig';

// Stored in the settings file under this key: one Coolify per machine whose
// containers it manages ("local" is this computer, otherwise a server's id).
// An unreadable value is ignored and the list starts empty.
const STORAGE_KEY = 'coolify';
const SAVE_DELAY_MS = 100;

/** How to reach a Coolify. The token is kept as plain text in the settings file, which the form says out loud. */
export interface CoolifyConfig {
    url: string;
    token: string;
}

export type CoolifyConfigs = Record<string, CoolifyConfig>;

/** The key of the machine a container runs on. */
export const coolifyKey = (hostId: string) => hostId || 'local';

function load(): CoolifyConfigs {
    try {
        const parsed = readConfig(STORAGE_KEY);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: CoolifyConfigs = {};
        for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
            const v = raw as Record<string, unknown> | null;
            if (v && typeof v.url === 'string' && typeof v.token === 'string' && v.url && v.token) {
                out[key.slice(0, 128)] = { url: v.url.slice(0, 512), token: v.token.slice(0, 1024) };
            }
        }
        return out;
    } catch {
        return {};
    }
}

export interface CoolifyApi {
    get: (hostId: string) => CoolifyConfig | undefined;
    set: (hostId: string, cfg: CoolifyConfig) => void;
    remove: (hostId: string) => void;
}

export function useCoolify(): CoolifyApi {
    const [configs, setConfigs] = useState<CoolifyConfigs>(load);
    const latest = useRef(configs);
    latest.current = configs;
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const get = useCallback((hostId: string) => latest.current[coolifyKey(hostId)], []);

    const set = useCallback((hostId: string, cfg: CoolifyConfig) => {
        latest.current = { ...latest.current, [coolifyKey(hostId)]: cfg };
        setConfigs(latest.current);
    }, []);

    const remove = useCallback((hostId: string) => {
        const next = { ...latest.current };
        delete next[coolifyKey(hostId)];
        latest.current = next;
        setConfigs(next);
    }, []);

    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => writeConfig(STORAGE_KEY, configs), SAVE_DELAY_MS);
        return () => clearTimeout(timer.current);
    }, [configs]);

    useEffect(() => {
        const onHide = () => writeConfig(STORAGE_KEY, latest.current);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('beforeunload', onHide);
        return () => {
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('beforeunload', onHide);
        };
    }, []);

    return { get, set, remove };
}

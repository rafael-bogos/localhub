import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteCloseTunnel, RemoteOpenForward } from '../wailsjs/go/main/App';
import { ssh } from '../wailsjs/go/models';
import { connInfo, type ConnInfo } from './useSshConnections';
import type { SavedTunnel } from './useSavedTunnels';

export interface TunnelControl {
    /** The open tunnel behind a saved one, if any. */
    liveFor: (t: SavedTunnel) => ssh.TunnelInfo | undefined;
    open: (t: SavedTunnel) => Promise<void>;
    close: (t: SavedTunnel) => void;
    /** Why the last attempt to open a saved tunnel failed. */
    errors: Record<string, string>;
    /** Saved tunnels being opened right now. */
    busy: Set<string>;
}

function clean(err: unknown): string {
    return String(err).replace(/^Error:\s*/, '');
}

/**
 * Opens and closes saved tunnels and opens the "open on connect" ones when
 * their server connects. It lives at the app root so that works whichever
 * tab the connection was made from.
 */
export function useTunnelControl(
    saved: SavedTunnel[],
    live: ssh.TunnelInfo[],
    conns: Record<string, ConnInfo>
): TunnelControl {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<Set<string>>(new Set());
    const liveRef = useRef(live);
    liveRef.current = live;

    const liveFor = useCallback((t: SavedTunnel) => live.find((l) => l.savedId === t.id), [live]);

    const open = useCallback(async (t: SavedTunnel) => {
        if (liveRef.current.some((l) => l.savedId === t.id)) return;
        setBusy((b) => new Set(b).add(t.id));
        setErrors((e) => {
            if (!e[t.id]) return e;
            const next = { ...e };
            delete next[t.id];
            return next;
        });
        try {
            await RemoteOpenForward(t.hostId, t.id, t.name, t.remoteHost, t.remotePort, t.localPort);
        } catch (err) {
            setErrors((e) => ({ ...e, [t.id]: clean(err) }));
        } finally {
            setBusy((b) => {
                const next = new Set(b);
                next.delete(t.id);
                return next;
            });
        }
    }, []);

    const close = useCallback((t: SavedTunnel) => {
        const l = liveRef.current.find((x) => x.savedId === t.id);
        if (l) RemoteCloseTunnel(l.id).catch(() => {});
    }, []);

    // Open the "open on connect" tunnels when a server goes from not connected to connected.
    const prev = useRef<Record<string, string>>({});
    const savedRef = useRef(saved);
    savedRef.current = saved;
    useEffect(() => {
        const hostIds = new Set(savedRef.current.map((t) => t.hostId));
        for (const id of hostIds) {
            const now = connInfo(conns, id).state;
            if (now === 'connected' && prev.current[id] !== 'connected') {
                for (const t of savedRef.current) {
                    if (t.hostId === id && t.autoOpen) void open(t);
                }
            }
            prev.current[id] = now;
        }
    }, [conns, open]);

    return { liveFor, open, close, errors, busy };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { SSHConfirmHostKey, SSHConnect, SSHDisconnect } from '../wailsjs/go/main/App';
import { ssh } from '../wailsjs/go/models';
import { EventsOn } from '../wailsjs/runtime/runtime';
import type { SshHost } from './useSshHosts';

export type ConnState = 'connecting' | 'connected' | 'disconnected';

export interface ConnInfo {
    state: ConnState;
    /** Why the connection failed or dropped; empty after a user-requested disconnect. */
    message: string;
}

export interface HostKeyPrompt {
    hostId: string;
    address: string;
    keyType: string;
    fingerprint: string;
}

export type ConnectCode = 'ok' | 'passphrase_required' | 'bad_passphrase' | 'error';

export interface ConnectOutcome {
    code: ConnectCode;
    message: string;
}

interface StateEvent {
    state: ConnState;
    message: string;
}

interface HostKeyEvent {
    address: string;
    keyType: string;
    fingerprint: string;
}

const IDLE: ConnInfo = { state: 'disconnected', message: '' };

export interface SshConnectionsApi {
    /** State per server id; absent means never connected (same as disconnected). */
    conns: Record<string, ConnInfo>;
    /** Server whose key must be confirmed (first connection), if any. */
    hostKeyPrompt: HostKeyPrompt | null;
    answerHostKey: (accept: boolean) => void;
    /**
     * Connects and resolves when established or failed. The passphrase codes
     * mean "ask the user and call again"; they leave the state untouched.
     */
    connect: (host: SshHost, passphrase?: string) => Promise<ConnectOutcome>;
    disconnect: (id: string) => void;
}

export function useSshConnections(): SshConnectionsApi {
    const [conns, setConns] = useState<Record<string, ConnInfo>>({});
    const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPrompt | null>(null);
    // Event subscriptions per server, alive from the connect attempt until the
    // connection ends (state events keep flowing after a successful connect).
    const subs = useRef(new Map<string, Array<() => void>>());

    const unsubscribe = useCallback((id: string) => {
        subs.current.get(id)?.forEach((off) => off());
        subs.current.delete(id);
    }, []);

    const subscribe = useCallback(
        (id: string) => {
            unsubscribe(id);
            const offState = EventsOn(`ssh:state:${id}`, (ev: StateEvent) => {
                setConns((prev) => ({ ...prev, [id]: { state: ev.state, message: ev.message ?? '' } }));
                if (ev.state === 'disconnected') {
                    setHostKeyPrompt((p) => (p?.hostId === id ? null : p));
                    unsubscribe(id);
                }
            });
            const offKey = EventsOn(`ssh:hostkey:${id}`, (ev: HostKeyEvent) => {
                setHostKeyPrompt({ hostId: id, address: ev.address, keyType: ev.keyType, fingerprint: ev.fingerprint });
            });
            subs.current.set(id, [offState, offKey]);
        },
        [unsubscribe]
    );

    useEffect(() => {
        const all = subs.current;
        return () => {
            all.forEach((offs) => offs.forEach((off) => off()));
            all.clear();
        };
    }, []);

    const connect = useCallback(
        async (host: SshHost, passphrase = ''): Promise<ConnectOutcome> => {
            // Subscribe before calling: the first events fire while the call is pending.
            subscribe(host.id);
            let result: ssh.ConnectResult;
            try {
                result = await SSHConnect(
                    ssh.HostSpec.createFrom({
                        id: host.id,
                        address: host.address,
                        port: host.port,
                        user: host.user,
                        method: host.method,
                        keyPath: host.keyPath,
                    }),
                    passphrase
                );
            } catch (err) {
                unsubscribe(host.id);
                return { code: 'error', message: String(err) };
            }

            const code = result.code as ConnectCode;
            if (code === 'passphrase_required' || code === 'bad_passphrase') {
                unsubscribe(host.id);
            } else if (code === 'error') {
                // The backend already emitted "disconnected" for dial failures;
                // errors before dialing (unreadable key) emit nothing.
                setConns((prev) => ({ ...prev, [host.id]: { state: 'disconnected', message: result.message } }));
                unsubscribe(host.id);
            }
            return { code, message: result.message };
        },
        [subscribe, unsubscribe]
    );

    const disconnect = useCallback((id: string) => {
        SSHDisconnect(id).catch(() => {});
    }, []);

    const answerHostKey = useCallback(
        (accept: boolean) => {
            const prompt = hostKeyPrompt;
            setHostKeyPrompt(null);
            if (prompt) SSHConfirmHostKey(prompt.hostId, accept).catch(() => {});
        },
        [hostKeyPrompt]
    );

    return { conns, hostKeyPrompt, answerHostKey, connect, disconnect };
}

export function connInfo(conns: Record<string, ConnInfo>, id: string): ConnInfo {
    return conns[id] ?? IDLE;
}

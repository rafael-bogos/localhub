import { useCallback, useState, type ReactNode } from 'react';
import { HostKeyDialog, PassphrasePrompt } from './components/SshPrompts';
import type { SshConnectionsApi } from './useSshConnections';
import type { SshHost } from './useSshHosts';

interface PassphraseRequest {
    host: SshHost;
    retry: boolean;
    after?: () => void;
}

export interface SshConnectApi {
    /**
     * Connects to a server, asking for the passphrase when the key needs one.
     * `after` runs once the connection is established. Resolves true on success.
     */
    connectHost: (host: SshHost, after?: () => void) => Promise<boolean>;
    /** The passphrase and first-connection dialogs; render them once, at the app root. */
    dialogs: ReactNode;
}

/**
 * Connection flow shared by every place that can connect (the SSH tab and the
 * "Reconectar" action of a server group). Its dialogs live at the app root so
 * they show whichever tab is open.
 */
export function useSshConnect(connections: SshConnectionsApi, hosts: SshHost[]): SshConnectApi {
    const { connect, hostKeyPrompt, answerHostKey } = connections;
    const [request, setRequest] = useState<PassphraseRequest | null>(null);

    const connectHost = useCallback(
        async (host: SshHost, after?: () => void, passphrase = ''): Promise<boolean> => {
            const result = await connect(host, passphrase);
            if (result.code === 'ok') {
                after?.();
                return true;
            }
            if (result.code === 'passphrase_required' || result.code === 'bad_passphrase') {
                setRequest({ host, retry: result.code === 'bad_passphrase', after });
            }
            // 'error' is surfaced through the connection state.
            return false;
        },
        [connect]
    );

    const dialogs = (
        <>
            {request && (
                <PassphrasePrompt
                    hostName={request.host.name}
                    keyPath={request.host.keyPath}
                    retry={request.retry}
                    onCancel={() => setRequest(null)}
                    onSubmit={(pass) => {
                        const req = request;
                        setRequest(null);
                        connectHost(req.host, req.after, pass);
                    }}
                />
            )}
            {hostKeyPrompt && (
                <HostKeyDialog
                    prompt={hostKeyPrompt}
                    hostName={hosts.find((h) => h.id === hostKeyPrompt.hostId)?.name ?? hostKeyPrompt.address}
                    onAnswer={answerHostKey}
                />
            )}
        </>
    );

    return { connectHost: (host, after) => connectHost(host, after), dialogs };
}

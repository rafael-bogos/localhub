import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteKillProcess, RemoteListPorts } from '../../wailsjs/go/main/App';
import { ports, ssh } from '../../wailsjs/go/models';
import { AlertIcon } from './icons';
import { GroupNote } from './HostGroup';
import { useConfirm } from './ConfirmDialog';

const COOL_DOWN_MS = 340;

interface RemotePortsSectionProps {
    hostId: string;
    hostName: string;
    /** Bumped by the app's refresh button. */
    refreshKey: number;
    /** The header search box; matches the port number or the process name. */
    query: string;
    onCount: (n: number) => void;
}

/** Listening ports of one connected server, with the same rows and kill action as the local list. */
function RemotePortsSection({ hostId, hostName, refreshKey, query, onCount }: RemotePortsSectionProps) {
    const confirm = useConfirm();
    const [result, setResult] = useState<ssh.RemotePorts | null>(null);
    const [error, setError] = useState('');
    const [killingPid, setKillingPid] = useState<number | null>(null);
    const [coolingPid, setCoolingPid] = useState<number | null>(null);
    const countRef = useRef(onCount);
    countRef.current = onCount;

    const load = useCallback(async () => {
        setError('');
        try {
            const r = await RemoteListPorts(hostId);
            setResult(r);
            countRef.current(r.status === 'ok' ? (r.ports ?? []).length : 0);
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
            countRef.current(0);
        }
    }, [hostId]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    async function handleKill(p: ports.PortInfo) {
        const ok = await confirm(
            `Matar o processo "${p.processName || 'desconhecido'}" (PID ${p.pid}) na porta ${p.port}/${p.protocol.toUpperCase()} em "${hostName}"?`
        );
        if (!ok) return;
        setError('');
        setKillingPid(p.pid);
        try {
            await RemoteKillProcess(hostId, p.pid);
            setKillingPid(null);
            setCoolingPid(p.pid);
            await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            await load();
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            setKillingPid(null);
            setCoolingPid(null);
        }
    }

    const q = query.trim().toLowerCase();
    const list = (result?.ports ?? []).filter(
        (p) => !q || String(p.port).includes(q) || p.processName.toLowerCase().includes(q)
    );

    return (
        <>
            {error && (
                <p className="alert" role="alert">
                    <AlertIcon size={15} />
                    {error}
                </p>
            )}
            {!result && !error && <GroupNote>Carregando…</GroupNote>}
            {result && result.status !== 'ok' && <GroupNote tone="warn">{result.message}</GroupNote>}
            {result?.status === 'ok' && result.limited && (
                <GroupNote>
                    Visibilidade limitada: processos de outros usuários aparecem sem nome e não podem ser encerrados.
                </GroupNote>
            )}
            {result?.status === 'ok' && list.length === 0 && (
                <GroupNote>
                    {q ? `Nenhuma porta ou processo encontrado para "${query}" neste servidor.` : 'Nenhuma porta em escuta neste servidor.'}
                </GroupNote>
            )}
            {result?.status === 'ok' && list.length > 0 && (
                <table className="ports-table">
                    <thead>
                        <tr>
                            <th>Porta</th>
                            <th>Protocolo</th>
                            <th>Processo</th>
                            <th>PID</th>
                            <th>Estado</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.map((p) => {
                            const canKill = p.pid > 1;
                            const isKilling = killingPid === p.pid;
                            const isCooling = coolingPid === p.pid;
                            return (
                                <tr
                                    key={`${p.protocol}-${p.port}-${p.pid}`}
                                    className={[
                                        'port-row',
                                        !canKill ? 'port-row--protected' : '',
                                        isCooling ? 'port-row--cooling' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    <td className="port-row__port">{p.port}</td>
                                    <td className="port-row__protocol">{p.protocol.toUpperCase()}</td>
                                    <td className="port-row__process" title={p.processName || undefined}>
                                        {p.processName || '—'}
                                    </td>
                                    <td className="port-row__pid">{p.pid > 0 ? p.pid : '—'}</td>
                                    <td className="port-row__status">
                                        <span
                                            className={`status-chip${p.status?.toUpperCase() === 'LISTEN' ? ' status-chip--listen' : ''}`}
                                        >
                                            {p.status || '—'}
                                        </span>
                                    </td>
                                    <td className="port-row__action">
                                        <div className="row-actions">
                                            <button
                                                className={`kill-key${isKilling ? ' kill-key--busy' : ''}`}
                                                disabled={!canKill || isKilling}
                                                title={
                                                    canKill
                                                        ? 'Matar processo'
                                                        : 'Processo de outro usuário — não pode ser encerrado'
                                                }
                                                onClick={() => handleKill(p)}
                                            >
                                                {isKilling ? 'Matando' : 'Matar'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </>
    );
}

export default RemotePortsSection;

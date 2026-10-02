import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteContainerAction, RemoteListContainers } from '../../wailsjs/go/main/App';
import { docker, ssh } from '../../wailsjs/go/models';
import { AlertIcon } from './icons';
import { GroupNote } from './HostGroup';
import { useConfirm } from './ConfirmDialog';

const COOL_DOWN_MS = 340;

type Action = 'start' | 'stop' | 'restart' | 'remove';

interface RemoteContainersSectionProps {
    hostId: string;
    hostName: string;
    refreshKey: number;
    onCount: (n: number) => void;
    onOpenLogs: (id: string, name: string) => void;
    /** Container whose logs are open for this server, to mark its row. */
    activeLogsId: string | null;
}

/** Docker containers of one connected server. CPU and memory are not sampled remotely. */
function RemoteContainersSection({
    hostId,
    hostName,
    refreshKey,
    onCount,
    onOpenLogs,
    activeLogsId,
}: RemoteContainersSectionProps) {
    const confirm = useConfirm();
    const [result, setResult] = useState<ssh.RemoteContainers | null>(null);
    const [error, setError] = useState('');
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<Action | null>(null);
    const [coolingId, setCoolingId] = useState<string | null>(null);
    const countRef = useRef(onCount);
    countRef.current = onCount;

    const load = useCallback(async () => {
        setError('');
        try {
            const r = await RemoteListContainers(hostId);
            setResult(r);
            countRef.current(r.status === 'ok' ? (r.items ?? []).length : 0);
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
            countRef.current(0);
        }
    }, [hostId]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    async function run(c: docker.ContainerInfo, action: Action, confirmMessage?: string) {
        if (confirmMessage && !(await confirm(confirmMessage))) return;
        setError('');
        setPendingId(c.id);
        setPendingAction(action);
        try {
            await RemoteContainerAction(hostId, c.id, action);
            if (action === 'remove') {
                setPendingAction(null);
                setCoolingId(c.id);
                await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            }
            await load();
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            setPendingId(null);
            setPendingAction(null);
            setCoolingId(null);
        }
    }

    const items = result?.items ?? [];

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
            {result?.status === 'ok' && items.length === 0 && <GroupNote>Nenhum container neste servidor.</GroupNote>}
            {result?.status === 'ok' && items.length > 0 && (
                <table className="remote-table remote-table--containers">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Imagem</th>
                            <th>Portas</th>
                            <th>Estado</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((c) => {
                            const isRunning = c.state === 'running';
                            const isPending = pendingId === c.id;
                            return (
                                <tr
                                    key={c.id}
                                    className={[
                                        'container-row',
                                        isRunning ? 'container-row--protected' : '',
                                        coolingId === c.id ? 'container-row--cooling' : '',
                                        activeLogsId === c.id ? 'container-row--logs' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    <td className="container-row__name">{c.name}</td>
                                    <td className="container-row__image" data-label="Imagem">
                                        {c.image}
                                    </td>
                                    <td className="container-row__ports" data-label="Portas">
                                        {c.ports || '—'}
                                    </td>
                                    <td data-label="Estado">
                                        <span className={`status-chip${isRunning ? ' status-chip--listen' : ''}`}>
                                            {c.status}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="row-actions">
                                            <button
                                                className="action-key"
                                                aria-pressed={activeLogsId === c.id}
                                                title="Ver os logs deste container"
                                                onClick={() => onOpenLogs(c.id, c.name)}
                                            >
                                                Logs
                                            </button>
                                            {isRunning ? (
                                                <>
                                                    <button
                                                        className="action-key"
                                                        disabled={isPending}
                                                        onClick={() =>
                                                            run(c, 'stop', `Parar o container "${c.name}" em "${hostName}"?`)
                                                        }
                                                    >
                                                        {isPending && pendingAction === 'stop' ? 'Parando' : 'Parar'}
                                                    </button>
                                                    <button
                                                        className="action-key"
                                                        disabled={isPending}
                                                        onClick={() =>
                                                            run(c, 'restart', `Reiniciar o container "${c.name}" em "${hostName}"?`)
                                                        }
                                                    >
                                                        {isPending && pendingAction === 'restart' ? 'Reiniciando' : 'Reiniciar'}
                                                    </button>
                                                    <button className="kill-key" disabled title="Pare o container antes de removê-lo">
                                                        Remover
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        className="action-key"
                                                        disabled={isPending}
                                                        onClick={() => run(c, 'start')}
                                                    >
                                                        {isPending && pendingAction === 'start' ? 'Iniciando' : 'Iniciar'}
                                                    </button>
                                                    <button
                                                        className="kill-key"
                                                        disabled={isPending}
                                                        onClick={() =>
                                                            run(
                                                                c,
                                                                'remove',
                                                                `Remover o container "${c.name}" em "${hostName}"? Essa ação não pode ser desfeita.`
                                                            )
                                                        }
                                                    >
                                                        {isPending && pendingAction === 'remove' ? 'Removendo' : 'Remover'}
                                                    </button>
                                                </>
                                            )}
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

export default RemoteContainersSection;

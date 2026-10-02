import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteCloseTunnel, RemoteContainerAction, RemoteListContainers } from '../../wailsjs/go/main/App';
import { docker, ssh } from '../../wailsjs/go/models';
import { AlertIcon, CloseIcon, InfoIcon } from './icons';
import ContainerDetailsDialog from './ContainerDetailsDialog';
import { displayName, isCustomName, type NameLabelApi } from '../containerName';
import TunnelDialog from './TunnelDialog';
import type { SshHost } from '../useSshHosts';
import { GroupNote } from './HostGroup';
import { useConfirm } from './ConfirmDialog';

const COOL_DOWN_MS = 340;

type Action = 'start' | 'stop' | 'restart' | 'remove';

interface RemoteContainersSectionProps {
    names: NameLabelApi;
    host: SshHost;
    /** Open tunnels, all servers; the section shows the ones of its own containers. */
    tunnels: ssh.TunnelInfo[];
    hostId: string;
    hostName: string;
    refreshKey: number;
    onCount: (n: number) => void;
    onOpenLogs: (id: string, name: string, label?: string) => void;
    /** Container whose logs are open for this server, to mark its row. */
    activeLogsId: string | null;
}

/** Docker containers of one connected server. CPU and memory are not sampled remotely. */
function RemoteContainersSection({
    names,
    host,
    tunnels,
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
    const [tunnelFor, setTunnelFor] = useState<docker.ContainerInfo | null>(null);
    const [details, setDetails] = useState<docker.ContainerInfo | null>(null);
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
                            const shown = displayName(c, names.nameLabel);
                            const custom = isCustomName(c, names.nameLabel);
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
                                    <td className="container-row__name">
                                        <span className="container-row__title">
                                            <span>{shown}</span>
                                            <button
                                                className="container-row__info"
                                                onClick={() => setDetails(c)}
                                                title="Detalhes e etiquetas"
                                                aria-label={`Detalhes e etiquetas de ${c.name}`}
                                            >
                                                <InfoIcon size={12} />
                                            </button>
                                        </span>
                                        {custom && (
                                            <span className="container-row__compose" title="Nome no Docker">
                                                {c.name}
                                            </span>
                                        )}
                                        {c.service && (
                                            <span
                                                className="container-row__compose"
                                                title={`Serviço ${c.service} do projeto Docker Compose ${c.project || '—'}`}
                                            >
                                                serviço: {c.service}
                                                {c.project ? ` · projeto: ${c.project}` : ''}
                                            </span>
                                        )}
                                        {tunnels
                                            .filter((t) => t.hostId === hostId && t.containerId === c.id)
                                            .map((t) => (
                                                <span
                                                    key={t.id}
                                                    className="status-chip status-chip--listen tunnel-chip"
                                                    title={`Túnel aberto: ${t.localAddr} leva a ${t.remoteIp}:${t.remotePort} (rede ${t.network})`}
                                                >
                                                    {t.localAddr} → {t.remotePort}
                                                    <button
                                                        className="tunnel-chip__close"
                                                        onClick={() => RemoteCloseTunnel(t.id).catch(() => {})}
                                                        aria-label={`Fechar o túnel ${t.localAddr}`}
                                                        title="Fechar este túnel"
                                                    >
                                                        <CloseIcon size={9} />
                                                    </button>
                                                </span>
                                            ))}
                                    </td>
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
                                                onClick={() => onOpenLogs(c.id, c.name, shown)}
                                            >
                                                Logs
                                            </button>
                                            {isRunning ? (
                                                <>
                                                    <button
                                                        className="action-key"
                                                        title="Abrir um túnel para uma porta deste container"
                                                        onClick={() => setTunnelFor(c)}
                                                    >
                                                        Túnel
                                                    </button>
                                                    <button
                                                        className="action-key"
                                                        disabled={isPending}
                                                        onClick={() =>
                                                            run(c, 'stop', `Parar o container "${shown}" em "${hostName}"?`)
                                                        }
                                                    >
                                                        {isPending && pendingAction === 'stop' ? 'Parando' : 'Parar'}
                                                    </button>
                                                    <button
                                                        className="action-key"
                                                        disabled={isPending}
                                                        onClick={() =>
                                                            run(c, 'restart', `Reiniciar o container "${shown}" em "${hostName}"?`)
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
                                                                `Remover o container "${shown}" em "${hostName}"? Essa ação não pode ser desfeita.`
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
            {details && (
                <ContainerDetailsDialog
                    container={details}
                    hostName={hostName}
                    nameLabel={names.nameLabel}
                    onNameLabelChange={names.setNameLabel}
                    onClose={() => setDetails(null)}
                />
            )}
            {tunnelFor && (
                <TunnelDialog
                    host={host}
                    container={{ id: tunnelFor.id, name: displayName(tunnelFor, names.nameLabel) }}
                    onClose={() => setTunnelFor(null)}
                />
            )}
        </>
    );
}

export default RemoteContainersSection;

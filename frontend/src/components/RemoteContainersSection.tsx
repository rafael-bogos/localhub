import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteCloseTunnel, RemoteContainerAction, RemoteListContainers, RemoteRebuildContainer, RemoteContainerRebuildInfos } from '../../wailsjs/go/main/App';
import { docker, ssh } from '../../wailsjs/go/models';
import {
    AlertIcon,
    CloseIcon,
    DatabaseIcon,
    RebuildIcon,
    DeployIcon,
    InfoIcon,
    LogsIcon,
    PlayIcon,
    RestartIcon,
    StopIcon,
    TerminalIcon,
    TrashIcon,
    TunnelIcon,
} from './icons';
import IconButton from './IconButton';
import RebuildStatus, { type RebuildInfo } from './RebuildStatus';
import type { RowAction } from './rowAction';
import { looksLikeDbImage } from '../dbImage';
import { matchesSearch } from '../search';
import ContainerDetailsDialog from './ContainerDetailsDialog';
import { displayName, isCustomName, type NameLabelApi } from '../containerName';
import TunnelDialog from './TunnelDialog';
import type { SshHost } from '../useSshHosts';
import { GroupNote } from './HostGroup';
import { useConfirm } from './ConfirmDialog';

const COOL_DOWN_MS = 340;

type Action = 'start' | 'stop' | 'restart' | 'remove' | 'db' | 'rebuild' | 'redeploy';

interface RemoteContainersSectionProps {
    /** The header search box: matches names, IDs, images and Compose service/project. */
    query: string;
    names: NameLabelApi;
    host: SshHost;
    /** Open tunnels, all servers; the section shows the ones of its own containers. */
    tunnels: ssh.TunnelInfo[];
    hostId: string;
    hostName: string;
    refreshKey: number;
    onCount: (n: number) => void;
    onOpenLogs: (id: string, name: string, label?: string) => void;
    /** Opens a terminal inside the container (shown in the Servidores tab). */
    onOpenTerminal: (container: { id: string; name: string }) => void;
    /** Opens the database in this container in the Bancos tab; rejects with the message to show. */
    onAccessDb: (containerName: string) => Promise<void>;
    /** Asks for the Coolify settings if needed and for confirmation; resolves with the function that does the redeploy, or null when the user backs out. */
    onPrepareRedeploy: (c: docker.ContainerInfo) => Promise<(() => Promise<void>) | null>;
    /** Container whose logs are open for this server, to mark its row. */
    activeLogsId: string | null;
}

/** Docker containers of one connected server. CPU and memory are not sampled remotely. */
function RemoteContainersSection({
    query,
    names,
    host,
    tunnels,
    hostId,
    hostName,
    refreshKey,
    onCount,
    onOpenLogs,
    onOpenTerminal,
    onAccessDb,
    onPrepareRedeploy,
    activeLogsId,
}: RemoteContainersSectionProps) {
    const confirm = useConfirm();
    const [result, setResult] = useState<ssh.RemoteContainers | null>(null);
    // Per Compose container: can it be rebuilt, or why not (see ContainersTable).
    const [rebuildInfo, setRebuildInfo] = useState<Record<string, RebuildInfo>>({});
    const [error, setError] = useState('');
    // What each container is doing right now, by ID: several can run at once
    // (two redeploys, a rebuild and a stop...). 'idle' keeps a row's buttons
    // disabled without showing a busy one (the cool-down after a removal).
    const [pending, setPending] = useState<Record<string, RowAction>>({});
    const beginPending = (id: string, action: RowAction) => setPending((p) => ({ ...p, [id]: action }));
    const endPending = (id: string) =>
        setPending((p) => {
            const next = { ...p };
            delete next[id];
            return next;
        });
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

    useEffect(() => {
        const items = result?.items ?? [];
        if (!items.some((c) => c.project && c.service)) {
            setRebuildInfo({});
            return;
        }
        let live = true;
        RemoteContainerRebuildInfos(hostId, items)
            .then((info) => live && setRebuildInfo(info ?? {}))
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [hostId, result]);

    async function accessDb(c: docker.ContainerInfo) {
        setError('');
        beginPending(c.id, 'db');
        try {
            await onAccessDb(c.name);
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            endPending(c.id);
        }
    }

    async function handleRedeploy(c: docker.ContainerInfo) {
        const run = await onPrepareRedeploy(c);
        if (!run) return;
        setError('');
        beginPending(c.id, 'redeploy');
        try {
            await run();
            await load();
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            endPending(c.id);
        }
    }

    async function rebuild(c: docker.ContainerInfo, shown: string) {
        const ok = await confirm(
            `Reconstruir o container "${shown}" em "${hostName}"? A imagem do serviço "${c.service}" será refeita no servidor e o container recriado (pode demorar). Ele fica fora do ar durante a troca.`
        );
        if (!ok) return;
        setError('');
        beginPending(c.id, 'rebuild');
        try {
            await RemoteRebuildContainer(hostId, c.id);
            await load();
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            endPending(c.id);
        }
    }

    async function run(c: docker.ContainerInfo, action: Action, confirmMessage?: string) {
        if (confirmMessage && !(await confirm(confirmMessage))) return;
        setError('');
        beginPending(c.id, action);
        try {
            await RemoteContainerAction(hostId, c.id, action);
            if (action === 'remove') {
                beginPending(c.id, 'idle');
                setCoolingId(c.id);
                await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            }
            await load();
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            endPending(c.id);
            setCoolingId(null);
        }
    }

    const all = result?.items ?? [];
    const items = all.filter((c) =>
        matchesSearch(query, c.name, displayName(c, names.nameLabel), c.id, c.image, c.service, c.project)
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
            {result?.status === 'ok' && all.length === 0 && <GroupNote>Nenhum container neste servidor.</GroupNote>}
            {result?.status === 'ok' && all.length > 0 && items.length === 0 && (
                <GroupNote>Nenhum container deste servidor corresponde a "{query.trim()}".</GroupNote>
            )}
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
                            const pendingAction = pending[c.id] ?? null;
                            const isPending = pendingAction !== null;
                            const shown = displayName(c, names.nameLabel);
                            const custom = isCustomName(c, names.nameLabel);
                            return (
                                <tr
                                    key={c.id}
                                    className={[
                                        'container-row',
                                        isRunning ? 'container-row--protected' : '',
                                        coolingId === c.id ? 'container-row--cooling' : '',
                                        isPending && (pendingAction === 'rebuild' || pendingAction === 'redeploy') ? 'container-row--rebuilding' : '',
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
                                        {isPending && (pendingAction === 'rebuild' || pendingAction === 'redeploy') && <RebuildStatus hostId={hostId} containerId={c.id} />}
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
                                            <IconButton
                                                icon={<LogsIcon />}
                                                label="Logs"
                                                title="Ver os logs deste container"
                                                pressed={activeLogsId === c.id}
                                                onClick={() => onOpenLogs(c.id, c.name, shown)}
                                            />
                                            {isRunning ? (
                                                <>
                                                    <IconButton
                                                        icon={<TerminalIcon />}
                                                        label="Terminal"
                                                        title="Abrir um terminal dentro deste container"
                                                        onClick={() => onOpenTerminal({ id: c.id, name: shown })}
                                                    />
                                                    {looksLikeDbImage(c.image) && (
                                                        <IconButton
                                                            icon={<DatabaseIcon />}
                                                            label={isPending && pendingAction === 'db' ? 'Acessando…' : 'Acessar banco'}
                                                            title="Abrir o banco deste container na aba Bancos (por túnel SSH)"
                                                            busy={isPending && pendingAction === 'db'}
                                                            disabled={isPending}
                                                            onClick={() => accessDb(c)}
                                                        />
                                                    )}
                                                    <IconButton
                                                        icon={<TunnelIcon />}
                                                        label="Túnel"
                                                        title="Abrir um túnel para uma porta deste container"
                                                        onClick={() => setTunnelFor(c)}
                                                    />
                                                    <IconButton
                                                        icon={<StopIcon />}
                                                        label={isPending && pendingAction === 'stop' ? 'Parando…' : 'Parar'}
                                                        busy={isPending && pendingAction === 'stop'}
                                                        disabled={isPending}
                                                        onClick={() =>
                                                            run(c, 'stop', `Parar o container "${shown}" em "${hostName}"?`)
                                                        }
                                                    />
                                                    <IconButton
                                                        icon={<RestartIcon />}
                                                        label={isPending && pendingAction === 'restart' ? 'Reiniciando…' : 'Reiniciar'}
                                                        busy={isPending && pendingAction === 'restart'}
                                                        disabled={isPending}
                                                        onClick={() =>
                                                            run(c, 'restart', `Reiniciar o container "${shown}" em "${hostName}"?`)
                                                        }
                                                    />
                                                    {rebuildInfo[c.id]?.build && (
                                                        <IconButton
                                                            icon={<RebuildIcon />}
                                                            label={isPending && pendingAction === 'rebuild' ? 'Reconstruindo…' : 'Reconstruir'}
                                                            title="Reconstruir a imagem no servidor e recriar o container (docker compose up --build)"
                                                            busy={isPending && pendingAction === 'rebuild'}
                                                            disabled={isPending}
                                                            onClick={() => rebuild(c, shown)}
                                                        />
                                                    )}
                                                    {rebuildInfo[c.id]?.redeploy && (
                                                        <IconButton
                                                            icon={<DeployIcon />}
                                                            label={isPending && pendingAction === 'redeploy' ? 'Fazendo deploy…' : 'Redeploy'}
                                                            title="Fazer o redeploy deste app pelo Coolify"
                                                            busy={isPending && pendingAction === 'redeploy'}
                                                            disabled={isPending}
                                                            onClick={() => handleRedeploy(c)}
                                                        />
                                                    )}
                                                    {rebuildInfo[c.id]?.problem && (
                                                        <IconButton
                                                            icon={<RebuildIcon />}
                                                            label="Reconstruir indisponível"
                                                            title={rebuildInfo[c.id].problem}
                                                            disabled
                                                        />
                                                    )}
                                                    <IconButton
                                                        danger
                                                        icon={<TrashIcon />}
                                                        label="Remover"
                                                        title="Pare o container antes de removê-lo"
                                                        disabled
                                                    />
                                                </>
                                            ) : (
                                                <>
                                                    <IconButton
                                                        icon={<PlayIcon />}
                                                        label={isPending && pendingAction === 'start' ? 'Iniciando…' : 'Iniciar'}
                                                        busy={isPending && pendingAction === 'start'}
                                                        disabled={isPending}
                                                        onClick={() => run(c, 'start')}
                                                    />
                                                    {rebuildInfo[c.id]?.build && (
                                                        <IconButton
                                                            icon={<RebuildIcon />}
                                                            label={isPending && pendingAction === 'rebuild' ? 'Reconstruindo…' : 'Reconstruir'}
                                                            title="Reconstruir a imagem no servidor e recriar o container (docker compose up --build)"
                                                            busy={isPending && pendingAction === 'rebuild'}
                                                            disabled={isPending}
                                                            onClick={() => rebuild(c, shown)}
                                                        />
                                                    )}
                                                    {rebuildInfo[c.id]?.redeploy && (
                                                        <IconButton
                                                            icon={<DeployIcon />}
                                                            label={isPending && pendingAction === 'redeploy' ? 'Fazendo deploy…' : 'Redeploy'}
                                                            title="Fazer o redeploy deste app pelo Coolify"
                                                            busy={isPending && pendingAction === 'redeploy'}
                                                            disabled={isPending}
                                                            onClick={() => handleRedeploy(c)}
                                                        />
                                                    )}
                                                    {rebuildInfo[c.id]?.problem && (
                                                        <IconButton
                                                            icon={<RebuildIcon />}
                                                            label="Reconstruir indisponível"
                                                            title={rebuildInfo[c.id].problem}
                                                            disabled
                                                        />
                                                    )}
                                                    <IconButton
                                                        danger
                                                        icon={<TrashIcon />}
                                                        label={isPending && pendingAction === 'remove' ? 'Removendo…' : 'Remover'}
                                                        busy={isPending && pendingAction === 'remove'}
                                                        disabled={isPending}
                                                        onClick={() =>
                                                            run(
                                                                c,
                                                                'remove',
                                                                `Remover o container "${shown}" em "${hostName}"? Essa ação não pode ser desfeita.`
                                                            )
                                                        }
                                                    />
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

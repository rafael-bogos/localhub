import { useEffect, useRef, useState } from 'react';
import {
    ListContainers,
    ListContainerStats,
    RemoveContainer,
    RestartContainer,
    StartContainer,
    ContainerRebuildInfos,
    RebuildContainer,
    StopContainer,
} from '../../wailsjs/go/main/App';
import { docker } from '../../wailsjs/go/models';
import { AlertIcon, BoxIcon, InfoIcon, PlayIcon, RestartIcon, SearchIcon, StopIcon, TrashIcon, LogsIcon, DatabaseIcon, RebuildIcon, DeployIcon } from './icons';
import { looksLikeDbImage } from '../dbImage';
import IconButton from './IconButton';
import RebuildStatus, { type RebuildInfo } from './RebuildStatus';
import type { RowAction } from './rowAction';
import { matchesSearch } from '../search';
import ContainerDetailsDialog from './ContainerDetailsDialog';
import { displayName, isCustomName, type NameLabelApi } from '../containerName';
import { useConfirm } from './ConfirmDialog';
import { formatBytes, formatPercent } from '../format';
import { useSelection, clickedControl } from '../useSelection';
import { runBatch } from '../batch';
import RowCheck from './RowCheck';
import BatchBar from './BatchBar';

const COOL_DOWN_MS = 340;
const STATS_INTERVAL_MS = 2000;

function memoryTitle(s?: docker.ContainerStats): string | undefined {
    if (!s || s.memLimit === 0) return undefined;
    return `${formatBytes(s.memUsage)} de ${formatBytes(s.memLimit)}`;
}

interface ContainersTableProps {
    /** The header search box: matches names, IDs, images and Compose service/project. */
    query: string;
    names: NameLabelApi;
    onCountChange: (count: number) => void;
    onOpenLogs: (id: string, name: string, label?: string) => void;
    /** Opens the database in this container in the Bancos tab; rejects with the message to show. */
    onAccessDb: (containerName: string) => Promise<void>;
    /** Asks for the Coolify settings if needed and for confirmation; resolves with the function that does the redeploy, or null when the user backs out. */
    onPrepareRedeploy: (c: docker.ContainerInfo) => Promise<(() => Promise<void>) | null>;
    activeLogsId: string | null;
}

function ContainersTable({ query, names, onCountChange, onOpenLogs, onAccessDb, onPrepareRedeploy, activeLogsId }: ContainersTableProps) {
    const confirm = useConfirm();
    const [containers, setContainers] = useState<docker.ContainerInfo[]>([]);
    // Per Compose container: whether its service builds an image (so there is
    // something to rebuild) or why its project could not be read. A service with
    // a ready-made image, like postgres, is absent: no button.
    const [rebuildInfo, setRebuildInfo] = useState<Record<string, RebuildInfo>>({});
    const [loading, setLoading] = useState(false);
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
    const [stats, setStats] = useState<Record<string, docker.ContainerStats>>({});
    const [details, setDetails] = useState<docker.ContainerInfo | null>(null);
    const countReported = useRef(false);
    const selection = useSelection<string>();
    const [batchBusy, setBatchBusy] = useState(false);

    useEffect(() => {
        if (!containers.some((c) => c.project && c.service)) {
            setRebuildInfo({});
            return;
        }
        let live = true;
        ContainerRebuildInfos(containers)
            .then((info) => live && setRebuildInfo(info ?? {}))
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [containers]);

    async function load() {
        setLoading(true);
        setError('');
        try {
            const result = await ListContainers();
            setContainers(result);
            onCountChange(result.length);
            countReported.current = true;
        } catch (err) {
            setError(String(err));
            if (!countReported.current) {
                onCountChange(0);
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const visible = containers.filter((c) =>
        matchesSearch(query, c.name, displayName(c, names.nameLabel), c.id, c.image, c.service, c.project)
    );
    const runningCount = containers.filter((c) => c.state === 'running').length;
    const hasRunning = runningCount > 0;
    const sampled = containers.filter((c) => c.state === 'running' && stats[c.id]);
    const totalCpu = sampled.reduce((sum, c) => sum + stats[c.id].cpuPercent, 0);
    const totalMem = sampled.reduce((sum, c) => sum + stats[c.id].memUsage, 0);

    // Metrics are sampled in their own loop (each round takes ~2s on the
    // daemon side), so the list itself never waits on them. A round only
    // starts after the previous one finished, and pauses while the window is
    // hidden.
    useEffect(() => {
        if (!hasRunning) {
            setStats({});
            return;
        }

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;

        async function poll() {
            if (!document.hidden) {
                try {
                    const result = await ListContainerStats();
                    if (cancelled) return;
                    setStats(Object.fromEntries(result.map((r) => [r.id, r])));
                } catch {
                    // Metrics are best-effort: keep showing the last sample.
                }
            }
            if (!cancelled) {
                timer = setTimeout(poll, STATS_INTERVAL_MS);
            }
        }

        poll();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [hasRunning]);

    async function handleRedeploy(c: docker.ContainerInfo) {
        setError('');
        let run: (() => Promise<void>) | null;
        try {
            run = await onPrepareRedeploy(c);
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
            return;
        }
        if (!run) return;
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

    async function handleRebuild(c: docker.ContainerInfo) {
        const confirmed = await confirm(
            `Reconstruir o container "${displayName(c, names.nameLabel)}"? A imagem do serviço "${c.service}" será refeita e o container recriado (pode demorar). Ele fica fora do ar durante a troca.`
        );
        if (!confirmed) return;

        setError('');
        beginPending(c.id, 'rebuild');
        try {
            await RebuildContainer(c.id);
            await load();
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            endPending(c.id);
        }
    }

    async function handleAccessDb(c: docker.ContainerInfo) {
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

    async function handleStart(c: docker.ContainerInfo) {
        setError('');
        beginPending(c.id, 'start');
        try {
            await StartContainer(c.id);
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            endPending(c.id);
        }
    }

    async function handleStop(c: docker.ContainerInfo) {
        const confirmed = await confirm(`Parar o container "${displayName(c, names.nameLabel)}"?`);
        if (!confirmed) return;

        setError('');
        beginPending(c.id, 'stop');
        try {
            await StopContainer(c.id);
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            endPending(c.id);
        }
    }

    async function handleRestart(c: docker.ContainerInfo) {
        const confirmed = await confirm(`Reiniciar o container "${displayName(c, names.nameLabel)}"?`);
        if (!confirmed) return;

        setError('');
        beginPending(c.id, 'restart');
        try {
            await RestartContainer(c.id);
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            endPending(c.id);
        }
    }

    // Batch actions over the containers picked in the table (or, for "stop
    // all", every running one on this machine, filtered out or not).
    async function runContainerBatch(
        verb: string,
        targets: docker.ContainerInfo[],
        action: (id: string) => Promise<void>,
        warning = ''
    ) {
        if (targets.length === 0) return;
        const confirmed = await confirm(`${verb} ${targets.length} container(es)?${warning}`);
        if (!confirmed) return;

        setError('');
        setBatchBusy(true);
        try {
            const failures = await runBatch(targets, (c) => action(c.id), (c) => displayName(c, names.nameLabel));
            selection.clear();
            await load();
            if (failures) setError(failures);
        } finally {
            setBatchBusy(false);
        }
    }

    async function handleRemove(c: docker.ContainerInfo) {
        const confirmed = await confirm(`Remover o container "${displayName(c, names.nameLabel)}"? Essa ação não pode ser desfeita.`);
        if (!confirmed) return;

        setError('');
        beginPending(c.id, 'remove');
        try {
            await RemoveContainer(c.id);
            beginPending(c.id, 'idle');
            setCoolingId(c.id);
            await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            endPending(c.id);
            setCoolingId(null);
        }
    }

    const picked = containers.filter((c) => selection.selected.has(c.id));
    const pickedRunning = picked.filter((c) => c.state === 'running');
    const pickedStopped = picked.filter((c) => c.state !== 'running');
    const visibleIds = visible.map((c) => c.id);
    const allVisiblePicked = visibleIds.length > 0 && visibleIds.every((id) => selection.selected.has(id));
    const someVisiblePicked = visibleIds.some((id) => selection.selected.has(id));
    const running = containers.filter((c) => c.state === 'running');

    if (!loading && containers.length === 0 && !error) {
        return (
            <div className="empty-state">
                <BoxIcon />
                <p>Nenhum container encontrado.</p>
            </div>
        );
    }

    return (
        <>
            {error && (
                <p className="alert" role="alert">
                    <AlertIcon size={15} />
                    {error}
                </p>
            )}

            {containers.length > 0 && (
                <dl className="containers-summary" aria-label="Resumo dos containers">
                    <div className="containers-summary__tile">
                        <dt>Rodando</dt>
                        <dd>{runningCount}</dd>
                    </div>
                    <div className="containers-summary__tile">
                        <dt>Parados</dt>
                        <dd>{containers.length - runningCount}</dd>
                    </div>
                    <div
                        className="containers-summary__tile"
                        title="Soma dos containers em execução — 100% equivale a um núcleo"
                    >
                        <dt>CPU total</dt>
                        <dd>{sampled.length > 0 ? formatPercent(totalCpu) : '—'}</dd>
                    </div>
                    <div className="containers-summary__tile" title="Soma da memória dos containers em execução">
                        <dt>Memória total</dt>
                        <dd>{sampled.length > 0 ? formatBytes(totalMem) : '—'}</dd>
                    </div>
                </dl>
            )}

            {containers.length > 0 && picked.length === 0 && hasRunning && (
                <div className="batch-toolbar">
                    <button
                        className="kill-key"
                        disabled={batchBusy}
                        title="Para todos os containers em execução nesta máquina"
                        onClick={() => runContainerBatch('Parar', running, StopContainer)}
                    >
                        {batchBusy ? 'Parando' : `Parar todos (${runningCount})`}
                    </button>
                </div>
            )}

            {picked.length > 0 && (
                <BatchBar count={picked.length} noun="container(es)" onClear={selection.clear}>
                    {pickedRunning.length > 0 && (
                        <>
                            <button
                                className="action-key"
                                disabled={batchBusy}
                                onClick={() => runContainerBatch('Parar', pickedRunning, StopContainer)}
                            >
                                Parar ({pickedRunning.length})
                            </button>
                            <button
                                className="action-key"
                                disabled={batchBusy}
                                onClick={() => runContainerBatch('Reiniciar', pickedRunning, RestartContainer)}
                            >
                                Reiniciar ({pickedRunning.length})
                            </button>
                        </>
                    )}
                    {pickedStopped.length > 0 && (
                        <>
                            <button
                                className="action-key"
                                disabled={batchBusy}
                                onClick={() => runContainerBatch('Iniciar', pickedStopped, StartContainer)}
                            >
                                Iniciar ({pickedStopped.length})
                            </button>
                            <button
                                className="kill-key"
                                disabled={batchBusy}
                                onClick={() =>
                                    runContainerBatch('Remover', pickedStopped, RemoveContainer, ' Essa ação não pode ser desfeita.')
                                }
                            >
                                Remover ({pickedStopped.length})
                            </button>
                        </>
                    )}
                </BatchBar>
            )}

            {containers.length > 0 && visible.length === 0 && (
                <div className="empty-state">
                    <SearchIcon size={32} />
                    <p>Nenhum container encontrado para "{query.trim()}".</p>
                </div>
            )}

            {visible.length > 0 && (
                <table className="containers-table">
                    <thead>
                        <tr>
                            <th>
                                <RowCheck
                                    checked={allVisiblePicked}
                                    indeterminate={someVisiblePicked}
                                    label="Selecionar todos os containers listados"
                                    onChange={() => selection.setMany(visibleIds, !allVisiblePicked)}
                                />
                                Nome
                            </th>
                            <th>Imagem</th>
                            <th>Portas</th>
                            <th>CPU</th>
                            <th>Memória</th>
                            <th>Estado</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((c) => {
                            const isRunning = c.state === 'running';
                            const pendingAction = pending[c.id] ?? null;
                            const isPending = pendingAction !== null;
                            const isCooling = coolingId === c.id;
                            const shown = displayName(c, names.nameLabel);
                            const custom = isCustomName(c, names.nameLabel);

                            return (
                                <tr
                                    key={c.id}
                                    className={[
                                        'container-row',
                                        !isRunning ? '' : 'container-row--protected',
                                        isCooling ? 'container-row--cooling' : '',
                                        isPending && (pendingAction === 'rebuild' || pendingAction === 'redeploy') ? 'container-row--rebuilding' : '',
                                        activeLogsId === c.id ? 'container-row--logs' : '',
                                        'row--selectable',
                                        selection.selected.has(c.id) ? 'row--selected' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                    onClick={(e) => {
                                        if (!clickedControl(e)) selection.toggle(c.id);
                                    }}
                                >
                                    <td className="container-row__name">
                                        <span className="container-row__title">
                                            <RowCheck
                                                checked={selection.selected.has(c.id)}
                                                label={`Selecionar ${shown}`}
                                                onChange={() => selection.toggle(c.id)}
                                            />
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
                                        {isPending && (pendingAction === 'rebuild' || pendingAction === 'redeploy') && <RebuildStatus hostId="" containerId={c.id} />}
                                    </td>
                                    <td className="container-row__image" data-label="Imagem">{c.image}</td>
                                    <td className="container-row__ports" data-label="Portas">{c.ports || '—'}</td>
                                    <td className="container-row__metric" data-label="CPU">
                                        {isRunning && stats[c.id] ? formatPercent(stats[c.id].cpuPercent) : '—'}
                                    </td>
                                    <td className="container-row__metric" data-label="Memória" title={memoryTitle(stats[c.id])}>
                                        {isRunning && stats[c.id] ? (
                                            <>
                                                {formatBytes(stats[c.id].memUsage)}
                                                {stats[c.id].memLimit > 0 && (
                                                    <span className="container-row__metric-sub">
                                                        {formatPercent(stats[c.id].memPercent)}
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            '—'
                                        )}
                                    </td>
                                    <td>
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
                                                    {looksLikeDbImage(c.image) && (
                                                        <IconButton
                                                            icon={<DatabaseIcon />}
                                                            label={isPending && pendingAction === 'db' ? 'Acessando…' : 'Acessar banco'}
                                                            title="Abrir o banco deste container na aba Bancos"
                                                            busy={isPending && pendingAction === 'db'}
                                                            disabled={isPending}
                                                            onClick={() => handleAccessDb(c)}
                                                        />
                                                    )}
                                                    <IconButton
                                                        icon={<StopIcon />}
                                                        label={isPending && pendingAction === 'stop' ? 'Parando…' : 'Parar'}
                                                        busy={isPending && pendingAction === 'stop'}
                                                        disabled={isPending}
                                                        onClick={() => handleStop(c)}
                                                    />
                                                    <IconButton
                                                        icon={<RestartIcon />}
                                                        label={isPending && pendingAction === 'restart' ? 'Reiniciando…' : 'Reiniciar'}
                                                        busy={isPending && pendingAction === 'restart'}
                                                        disabled={isPending}
                                                        onClick={() => handleRestart(c)}
                                                    />
                                                    {rebuildInfo[c.id]?.build && (
                                                        <IconButton
                                                            icon={<RebuildIcon />}
                                                            label={isPending && pendingAction === 'rebuild' ? 'Reconstruindo…' : 'Reconstruir'}
                                                            title="Reconstruir a imagem e recriar o container (docker compose up --build)"
                                                            busy={isPending && pendingAction === 'rebuild'}
                                                            disabled={isPending}
                                                            onClick={() => handleRebuild(c)}
                                                        />
                                                    )}
                                                    {rebuildInfo[c.id]?.redeploy && (
                                                        <IconButton
                                                            icon={<DeployIcon />}
                                                            label={isPending && pendingAction === 'redeploy' ? 'Fazendo deploy…' : 'Redeploy'}
                                                            title="Fazer o redeploy deste app pelo Coolify (busca o código mais recente do repositório)"
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
                                                        onClick={() => handleStart(c)}
                                                    />
                                                    {rebuildInfo[c.id]?.build && (
                                                        <IconButton
                                                            icon={<RebuildIcon />}
                                                            label={isPending && pendingAction === 'rebuild' ? 'Reconstruindo…' : 'Reconstruir'}
                                                            title="Reconstruir a imagem e recriar o container (docker compose up --build)"
                                                            busy={isPending && pendingAction === 'rebuild'}
                                                            disabled={isPending}
                                                            onClick={() => handleRebuild(c)}
                                                        />
                                                    )}
                                                    {rebuildInfo[c.id]?.redeploy && (
                                                        <IconButton
                                                            icon={<DeployIcon />}
                                                            label={isPending && pendingAction === 'redeploy' ? 'Fazendo deploy…' : 'Redeploy'}
                                                            title="Fazer o redeploy deste app pelo Coolify (busca o código mais recente do repositório)"
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
                                                        onClick={() => handleRemove(c)}
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
                    nameLabel={names.nameLabel}
                    onNameLabelChange={names.setNameLabel}
                    onClose={() => setDetails(null)}
                />
            )}
        </>
    );
}

export default ContainersTable;

import { useEffect, useRef, useState } from 'react';
import {
    ListContainers,
    ListContainerStats,
    RemoveContainer,
    RestartContainer,
    StartContainer,
    StopContainer,
} from '../../wailsjs/go/main/App';
import { docker } from '../../wailsjs/go/models';
import { AlertIcon, BoxIcon, InfoIcon, PlayIcon, RestartIcon, SearchIcon, StopIcon, TrashIcon, LogsIcon } from './icons';
import IconButton from './IconButton';
import { matchesSearch } from '../search';
import ContainerDetailsDialog from './ContainerDetailsDialog';
import { displayName, isCustomName, type NameLabelApi } from '../containerName';
import { useConfirm } from './ConfirmDialog';
import { formatBytes, formatPercent } from '../format';

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
    activeLogsId: string | null;
}

function ContainersTable({ query, names, onCountChange, onOpenLogs, activeLogsId }: ContainersTableProps) {
    const confirm = useConfirm();
    const [containers, setContainers] = useState<docker.ContainerInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<'start' | 'stop' | 'restart' | 'remove' | null>(null);
    const [coolingId, setCoolingId] = useState<string | null>(null);
    const [stats, setStats] = useState<Record<string, docker.ContainerStats>>({});
    const [details, setDetails] = useState<docker.ContainerInfo | null>(null);
    const countReported = useRef(false);

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

    async function handleStart(c: docker.ContainerInfo) {
        setError('');
        setPendingId(c.id);
        setPendingAction('start');
        try {
            await StartContainer(c.id);
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            setPendingId(null);
            setPendingAction(null);
        }
    }

    async function handleStop(c: docker.ContainerInfo) {
        const confirmed = await confirm(`Parar o container "${displayName(c, names.nameLabel)}"?`);
        if (!confirmed) return;

        setError('');
        setPendingId(c.id);
        setPendingAction('stop');
        try {
            await StopContainer(c.id);
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            setPendingId(null);
            setPendingAction(null);
        }
    }

    async function handleRestart(c: docker.ContainerInfo) {
        const confirmed = await confirm(`Reiniciar o container "${displayName(c, names.nameLabel)}"?`);
        if (!confirmed) return;

        setError('');
        setPendingId(c.id);
        setPendingAction('restart');
        try {
            await RestartContainer(c.id);
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            setPendingId(null);
            setPendingAction(null);
        }
    }

    async function handleRemove(c: docker.ContainerInfo) {
        const confirmed = await confirm(`Remover o container "${displayName(c, names.nameLabel)}"? Essa ação não pode ser desfeita.`);
        if (!confirmed) return;

        setError('');
        setPendingId(c.id);
        setPendingAction('remove');
        try {
            await RemoveContainer(c.id);
            setPendingAction(null);
            setCoolingId(c.id);
            await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            setPendingId(null);
            setPendingAction(null);
            setCoolingId(null);
        }
    }

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
                            <th>Nome</th>
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
                            const isPending = pendingId === c.id;
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

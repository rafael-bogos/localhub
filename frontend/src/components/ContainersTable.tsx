import { useEffect, useRef, useState } from 'react';
import {
    ListContainers,
    RemoveContainer,
    RestartContainer,
    StartContainer,
    StopContainer,
} from '../../wailsjs/go/main/App';
import { docker } from '../../wailsjs/go/models';
import { AlertIcon, BoxIcon } from './icons';

const COOL_DOWN_MS = 340;

interface ContainersTableProps {
    onCountChange: (count: number) => void;
}

function ContainersTable({ onCountChange }: ContainersTableProps) {
    const [containers, setContainers] = useState<docker.ContainerInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<'start' | 'stop' | 'restart' | 'remove' | null>(null);
    const [coolingId, setCoolingId] = useState<string | null>(null);
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
        const confirmed = window.confirm(`Parar o container "${c.name}"?`);
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
        const confirmed = window.confirm(`Reiniciar o container "${c.name}"?`);
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
        const confirmed = window.confirm(`Remover o container "${c.name}"? Essa ação não pode ser desfeita.`);
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
                <table className="containers-table">
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
                        {containers.map((c) => {
                            const isRunning = c.state === 'running';
                            const isPending = pendingId === c.id;
                            const isCooling = coolingId === c.id;

                            return (
                                <tr
                                    key={c.id}
                                    className={[
                                        'container-row',
                                        !isRunning ? '' : 'container-row--protected',
                                        isCooling ? 'container-row--cooling' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    <td className="container-row__name">{c.name}</td>
                                    <td className="container-row__image">{c.image}</td>
                                    <td className="container-row__ports">{c.ports || '—'}</td>
                                    <td>
                                        <span className={`status-chip${isRunning ? ' status-chip--listen' : ''}`}>
                                            {c.status}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="row-actions">
                                            {isRunning ? (
                                                <>
                                                    <button
                                                        className="action-key"
                                                        disabled={isPending}
                                                        onClick={() => handleStop(c)}
                                                    >
                                                        {isPending && pendingAction === 'stop' ? 'Parando' : 'Parar'}
                                                    </button>
                                                    <button
                                                        className="action-key"
                                                        disabled={isPending}
                                                        onClick={() => handleRestart(c)}
                                                    >
                                                        {isPending && pendingAction === 'restart' ? 'Reiniciando' : 'Reiniciar'}
                                                    </button>
                                                    <button
                                                        className="kill-key"
                                                        disabled
                                                        title="Pare o container antes de removê-lo"
                                                    >
                                                        Remover
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        className="action-key"
                                                        disabled={isPending}
                                                        onClick={() => handleStart(c)}
                                                    >
                                                        {isPending && pendingAction === 'start' ? 'Iniciando' : 'Iniciar'}
                                                    </button>
                                                    <button
                                                        className="kill-key"
                                                        disabled={isPending}
                                                        onClick={() => handleRemove(c)}
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

export default ContainersTable;

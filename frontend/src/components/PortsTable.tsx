import { useState } from 'react';
import { ListChildProcesses } from '../../wailsjs/go/main/App';
import { ports } from '../../wailsjs/go/models';
import { AlertIcon, ChevronIcon, UnplugIcon } from './icons';

interface PortsTableProps {
    ports: ports.PortInfo[];
    searchQuery?: string;
    onKill: (port: ports.PortInfo) => void;
    onKillParent: (pid: number, processName: string) => void;
    /** Container that publishes each port, keyed "protocol:port". */
    portOwners: Record<string, { id: string; name: string }>;
    onOpenLogs: (id: string, name: string) => void;
    killingPid: number | null;
    coolingPid: number | null;
    error: string;
}

function PortsTable({
    ports,
    searchQuery,
    onKill,
    onKillParent,
    portOwners,
    onOpenLogs,
    killingPid,
    coolingPid,
    error,
}: PortsTableProps) {
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [children, setChildren] = useState<Record<number, ports.PortInfo[]>>({});
    const [loadingParent, setLoadingParent] = useState<number | null>(null);
    const [childError, setChildError] = useState<Record<number, string>>({});

    async function toggle(parentPid: number) {
        if (expanded.has(parentPid)) {
            setExpanded((prev) => {
                const next = new Set(prev);
                next.delete(parentPid);
                return next;
            });
            return;
        }

        setExpanded((prev) => new Set(prev).add(parentPid));

        if (children[parentPid]) {
            return;
        }

        setLoadingParent(parentPid);
        setChildError((prev) => ({ ...prev, [parentPid]: '' }));
        try {
            const result = await ListChildProcesses(parentPid);
            setChildren((prev) => ({ ...prev, [parentPid]: result }));
        } catch (err) {
            setChildError((prev) => ({ ...prev, [parentPid]: String(err) }));
        } finally {
            setLoadingParent(null);
        }
    }

    function renderChildRow(p: ports.PortInfo, nested: boolean) {
        const canKill = p.pid > 0;
        const isKilling = killingPid === p.pid;
        const isCooling = coolingPid === p.pid;
        const isListening = p.status?.toUpperCase() === 'LISTEN';
        const owner = portOwners[`${p.protocol}:${p.port}`];

        return (
            <tr
                key={`${p.protocol}-${p.port}-${p.pid}`}
                className={[
                    'port-row',
                    nested ? 'port-row--nested' : '',
                    !canKill ? 'port-row--protected' : '',
                    isCooling ? 'port-row--cooling' : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
            >
                <td className="port-row__port">{p.port}</td>
                <td className="port-row__protocol">{p.protocol.toUpperCase()}</td>
                <td
                    className="port-row__process"
                    title={owner ? `${p.processName || '—'} · container ${owner.name}` : p.processName || undefined}
                >
                    {p.processName || '—'}
                    {owner && <span className="port-row__container">{owner.name}</span>}
                </td>
                <td className="port-row__pid">{p.pid > 0 ? p.pid : '—'}</td>
                <td className="port-row__status">
                    <span className={`status-chip${isListening ? ' status-chip--listen' : ''}`}>
                        {p.status || '—'}
                    </span>
                </td>
                <td className="port-row__action">
                    <div className="row-actions">
                        {owner && (
                            <button
                                className="action-key"
                                title={`Ver os logs do container ${owner.name}`}
                                onClick={() => onOpenLogs(owner.id, owner.name)}
                            >
                                Logs
                            </button>
                        )}
                        <button
                            className={`kill-key${isKilling ? ' kill-key--busy' : ''}`}
                            disabled={!canKill || isKilling}
                            title={canKill ? 'Matar processo' : 'PID inválido — não pode ser encerrado'}
                            onClick={() => onKill(p)}
                        >
                            {isKilling ? 'Matando' : 'Matar'}
                        </button>
                    </div>
                </td>
            </tr>
        );
    }

    function renderParentGroup(group: ports.PortInfo) {
        const isOpen = expanded.has(group.pid);
        const isLoading = loadingParent === group.pid;
        const isKilling = killingPid === group.pid;
        const isCooling = coolingPid === group.pid;
        const error = childError[group.pid];

        return (
            <>
                <tr
                    key={`parent-${group.pid}`}
                    className={['port-row', 'port-row--parent', isCooling ? 'port-row--cooling' : '']
                        .filter(Boolean)
                        .join(' ')}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggle(group.pid)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggle(group.pid);
                        }
                    }}
                    title={isOpen ? 'Recolher processos filhos' : 'Ver processos filhos'}
                >
                    <td className="port-row__port" colSpan={2}>
                        <span className="port-row__expand">
                            <ChevronIcon size={12} className={isOpen ? 'port-row__expand-icon--open' : undefined} />
                            {isLoading
                                ? 'Buscando…'
                                : `${group.childCount} ${group.childCount === 1 ? 'porta' : 'portas'}`}
                        </span>
                    </td>
                    <td className="port-row__process" title={group.processName}>
                        {group.processName}
                    </td>
                    <td className="port-row__pid">{group.pid}</td>
                    <td className="port-row__status">
                        <span className="status-chip">processo pai</span>
                    </td>
                    <td className="port-row__action">
                        <button
                            className={`kill-key${isKilling ? ' kill-key--busy' : ''}`}
                            disabled={isKilling}
                            title="Matar processo pai — pode encerrar os filhos junto"
                            onClick={(e) => {
                                e.stopPropagation();
                                onKillParent(group.pid, group.processName);
                            }}
                        >
                            {isKilling ? 'Matando' : 'Matar'}
                        </button>
                    </td>
                </tr>
                {isOpen && error && (
                    <tr className="port-row port-row--nested">
                        <td colSpan={6}>
                            <p className="alert" role="alert" style={{ margin: 0 }}>
                                <AlertIcon size={15} />
                                {error}
                            </p>
                        </td>
                    </tr>
                )}
                {isOpen && !isLoading && !error && (children[group.pid] || []).length === 0 && (
                    <tr className="port-row port-row--nested">
                        <td colSpan={6}>
                            <p className="alert" role="alert" style={{ margin: 0 }}>
                                <AlertIcon size={15} />
                                Nenhum processo filho encontrado — provavelmente já encerrou.
                            </p>
                        </td>
                    </tr>
                )}
                {isOpen && !error && (children[group.pid] || []).map((p) => renderChildRow(p, true))}
            </>
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

            {ports.length === 0 ? (
                <div className="empty-state">
                    <UnplugIcon />
                    <p>
                        {searchQuery
                            ? `Nenhuma porta ou processo encontrado para "${searchQuery}".`
                            : 'Nenhuma porta encontrada.'}
                    </p>
                </div>
            ) : (
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
                        {ports.map((p) =>
                            p.childCount > 0 ? renderParentGroup(p) : renderChildRow(p, false)
                        )}
                    </tbody>
                </table>
            )}
        </>
    );
}

export default PortsTable;

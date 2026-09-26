import { ports } from '../../wailsjs/go/models';
import { AlertIcon, UnplugIcon } from './icons';

interface PortsTableProps {
    ports: ports.PortInfo[];
    onKill: (port: ports.PortInfo) => void;
    killingPid: number | null;
    coolingPid: number | null;
    error: string;
}

function PortsTable({ ports, onKill, killingPid, coolingPid, error }: PortsTableProps) {
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
                    <p>Nenhuma porta encontrada.</p>
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
                        {ports.map((p) => {
                            const canKill = p.pid > 0;
                            const isKilling = killingPid === p.pid;
                            const isCooling = coolingPid === p.pid;
                            const isListening = p.status?.toUpperCase() === 'LISTEN';

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
                                        <span className={`status-chip${isListening ? ' status-chip--listen' : ''}`}>
                                            {p.status || '—'}
                                        </span>
                                    </td>
                                    <td className="port-row__action">
                                        <button
                                            className={`kill-key${isKilling ? ' kill-key--busy' : ''}`}
                                            disabled={!canKill || isKilling}
                                            title={canKill ? 'Matar processo' : 'PID inválido — não pode ser encerrado'}
                                            onClick={() => onKill(p)}
                                        >
                                            {isKilling ? 'Matando' : 'Matar'}
                                        </button>
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

export default PortsTable;

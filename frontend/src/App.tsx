import { useEffect, useRef, useState } from 'react';
import './App.css';
import { KillProcess, ListPorts } from '../wailsjs/go/main/App';
import { ports } from '../wailsjs/go/models';
import PortsTable from './components/PortsTable';
import { RefreshIcon } from './components/icons';

const COOL_DOWN_MS = 340;

function App() {
    const [portList, setPortList] = useState<ports.PortInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [killingPid, setKillingPid] = useState<number | null>(null);
    const [coolingPid, setCoolingPid] = useState<number | null>(null);
    const [tick, setTick] = useState(false);
    const prevCount = useRef(0);

    async function loadPorts() {
        setLoading(true);
        setError('');
        try {
            const result = await ListPorts();
            setPortList(result);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    async function handleKill(port: ports.PortInfo) {
        const confirmed = window.confirm(
            `Matar o processo "${port.processName || 'desconhecido'}" (PID ${port.pid}) na porta ${port.port}/${port.protocol.toUpperCase()}?`
        );
        if (!confirmed) {
            return;
        }

        setError('');
        setKillingPid(port.pid);
        try {
            await KillProcess(port.pid);
            setKillingPid(null);
            setCoolingPid(port.pid);
            await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            await loadPorts();
        } catch (err) {
            setError(String(err));
        } finally {
            setKillingPid(null);
            setCoolingPid(null);
        }
    }

    useEffect(() => {
        loadPorts();
    }, []);

    useEffect(() => {
        if (portList.length !== prevCount.current) {
            prevCount.current = portList.length;
            setTick(true);
            const id = setTimeout(() => setTick(false), 260);
            return () => clearTimeout(id);
        }
    }, [portList.length]);

    return (
        <div className="app-shell">
            <header className="fascia">
                <div className="fascia__brand">
                    <span className="fascia__led" aria-hidden="true" />
                    <h1 className="fascia__wordmark">localhub</h1>
                </div>
                <div className="fascia__controls">
                    <div className="port-counter" title="Portas abertas no momento">
                        <span className={`port-counter__value${tick ? ' port-counter__value--tick' : ''}`}>
                            {portList.length}
                        </span>
                        <span className="port-counter__label">Portas</span>
                    </div>
                    <button
                        className={`refresh-btn${loading ? ' refresh-btn--loading' : ''}`}
                        onClick={loadPorts}
                        disabled={loading}
                        title={loading ? 'Atualizando...' : 'Atualizar'}
                        aria-label={loading ? 'Atualizando' : 'Atualizar'}
                    >
                        <RefreshIcon />
                    </button>
                </div>
            </header>

            <main className="instrument-panel">
                <PortsTable
                    ports={portList}
                    onKill={handleKill}
                    killingPid={killingPid}
                    coolingPid={coolingPid}
                    error={error}
                />
            </main>
        </div>
    );
}

export default App;

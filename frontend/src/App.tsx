import { useEffect, useRef, useState } from 'react';
import './App.css';
import { KillProcess, ListPorts } from '../wailsjs/go/main/App';
import { ports } from '../wailsjs/go/models';
import PortsTable from './components/PortsTable';
import ContainersTable from './components/ContainersTable';
import ImagesTable from './components/ImagesTable';
import { RefreshIcon } from './components/icons';

const COOL_DOWN_MS = 340;

type Tab = 'portas' | 'containers' | 'imagens';

const TAB_LABELS: Record<Tab, string> = {
    portas: 'Portas',
    containers: 'Containers',
    imagens: 'Imagens',
};

function App() {
    const [activeTab, setActiveTab] = useState<Tab>('portas');
    const [counts, setCounts] = useState<Record<Tab, number>>({ portas: 0, containers: 0, imagens: 0 });
    const [refreshKey, setRefreshKey] = useState(0);

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
            setCounts((prev) => ({ ...prev, portas: result.length }));
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

    const activeCount = counts[activeTab];

    function handleRefresh() {
        if (activeTab === 'portas') {
            loadPorts();
        } else {
            setRefreshKey((k) => k + 1);
        }
    }

    return (
        <div className="app-shell">
            <header className="fascia">
                <div className="fascia__brand">
                    <span className="fascia__led" aria-hidden="true" />
                    <h1 className="fascia__wordmark">localhub</h1>
                </div>

                <nav className="fascia__tabs">
                    {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
                        <button
                            key={tab}
                            className={`tab-btn${activeTab === tab ? ' tab-btn--active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {TAB_LABELS[tab]}
                        </button>
                    ))}
                </nav>

                <div className="fascia__controls">
                    <div className="port-counter" title={`${TAB_LABELS[activeTab]} listadas agora`}>
                        <span className={`port-counter__value${tick ? ' port-counter__value--tick' : ''}`}>
                            {activeCount}
                        </span>
                        <span className="port-counter__label">{TAB_LABELS[activeTab]}</span>
                    </div>
                    <button
                        className={`refresh-btn${loading && activeTab === 'portas' ? ' refresh-btn--loading' : ''}`}
                        onClick={handleRefresh}
                        disabled={loading && activeTab === 'portas'}
                        title={loading && activeTab === 'portas' ? 'Atualizando...' : 'Atualizar'}
                        aria-label={loading && activeTab === 'portas' ? 'Atualizando' : 'Atualizar'}
                    >
                        <RefreshIcon />
                    </button>
                </div>
            </header>

            <main className="instrument-panel">
                {activeTab === 'portas' && (
                    <PortsTable
                        ports={portList}
                        onKill={handleKill}
                        killingPid={killingPid}
                        coolingPid={coolingPid}
                        error={error}
                    />
                )}
                {activeTab === 'containers' && (
                    <ContainersTable
                        key={refreshKey}
                        onCountChange={(n) => setCounts((prev) => ({ ...prev, containers: n }))}
                    />
                )}
                {activeTab === 'imagens' && (
                    <ImagesTable
                        key={refreshKey}
                        onCountChange={(n) => setCounts((prev) => ({ ...prev, imagens: n }))}
                    />
                )}
            </main>
        </div>
    );
}

export default App;

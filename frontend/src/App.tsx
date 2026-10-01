import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { KillProcess, ListContainers, ListPortOwners, ListPorts } from '../wailsjs/go/main/App';
import { ports } from '../wailsjs/go/models';
import PortsTable from './components/PortsTable';
import ContainersTable from './components/ContainersTable';
import ImagesTable from './components/ImagesTable';
import CleanupPanel from './components/CleanupPanel';
import LogsDrawer, { type LogsTarget } from './components/LogsDrawer';
import { useLogsPrefs } from './useLogsPrefs';
import { RefreshIcon, SearchIcon, CloseIcon } from './components/icons';
import { useConfirm } from './components/ConfirmDialog';
import logo from './assets/images/localhub-logo.svg';

const COOL_DOWN_MS = 340;

type Tab = 'portas' | 'containers' | 'imagens' | 'limpeza';

const TAB_LABELS: Record<Tab, string> = {
    portas: 'Processos',
    containers: 'Containers',
    imagens: 'Imagens',
    limpeza: 'Limpeza',
};

function App() {
    const confirm = useConfirm();
    const [activeTab, setActiveTab] = useState<Tab>('portas');
    const [counts, setCounts] = useState<Record<Tab, number>>({ portas: 0, containers: 0, imagens: 0, limpeza: 0 });
    const [refreshKey, setRefreshKey] = useState(0);

    const [portList, setPortList] = useState<ports.PortInfo[]>([]);
    const [portSearch, setPortSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [killingPid, setKillingPid] = useState<number | null>(null);
    const [coolingPid, setCoolingPid] = useState<number | null>(null);
    const [tick, setTick] = useState(false);
    const prevCount = useRef(0);

    const [logsPrefs, updateLogsPrefs] = useLogsPrefs();
    const [logsTarget, setLogsTarget] = useState<LogsTarget | null>(null);
    const [portOwners, setPortOwners] = useState<Record<string, LogsTarget>>({});

    const openLogs = useCallback(
        (id: string, name: string) => {
            setLogsTarget({ id, name });
            updateLogsPrefs({ container: name });
        },
        [updateLogsPrefs]
    );

    const closeLogs = useCallback(() => {
        setLogsTarget(null);
        updateLogsPrefs({ container: null });
    }, [updateLogsPrefs]);

    // Reopen the container left open last time (kept by name: the id changes
    // when a container is recreated). If it no longer exists, start closed.
    useEffect(() => {
        const name = logsPrefs.container;
        if (!name) return;
        ListContainers()
            .then((all) => {
                const match = all.find((c) => c.name === name);
                if (match) setLogsTarget({ id: match.id, name: match.name });
                else updateLogsPrefs({ container: null });
            })
            .catch(() => {
                // Docker unreachable: leave the panel closed, keep the preference.
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadPorts() {
        setLoading(true);
        setError('');
        try {
            const result = await ListPorts();
            setPortList(result);
            setCounts((prev) => ({ ...prev, portas: result.length }));
            loadPortOwners();
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    // Which container publishes each port, for the "Logs" shortcut. Best-effort
    // and after the list is already on screen: with Docker off, the Portas tab
    // simply has no shortcut and no error.
    function loadPortOwners() {
        ListPortOwners()
            .then((owners) => {
                const map: Record<string, LogsTarget> = {};
                for (const o of owners) {
                    map[`${o.protocol}:${o.port}`] = { id: o.containerId, name: o.containerName };
                }
                setPortOwners(map);
            })
            .catch(() => setPortOwners({}));
    }

    async function killWithConfirm(pid: number, message: string) {
        const confirmed = await confirm(message);
        if (!confirmed) {
            return;
        }

        setError('');
        setKillingPid(pid);
        try {
            await KillProcess(pid);
            setKillingPid(null);
            setCoolingPid(pid);
            await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            await loadPorts();
        } catch (err) {
            setError(String(err));
        } finally {
            setKillingPid(null);
            setCoolingPid(null);
        }
    }

    async function handleKill(port: ports.PortInfo) {
        await killWithConfirm(
            port.pid,
            `Matar o processo "${port.processName || 'desconhecido'}" (PID ${port.pid}) na porta ${port.port}/${port.protocol.toUpperCase()}?`
        );
    }

    async function handleKillParent(pid: number, processName: string) {
        await killWithConfirm(
            pid,
            `Matar o processo "${processName || 'desconhecido'}" (PID ${pid})? Isso também pode encerrar os processos filhos dele.`
        );
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
    const filteredPorts = portSearch
        ? portList.filter((p) => String(p.port).includes(portSearch))
        : portList;

    function handlePortSearchChange(value: string) {
        setPortSearch(value.replace(/\D/g, ''));
    }

    function handleRefresh() {
        if (activeTab === 'portas') {
            loadPorts();
        } else if (activeTab !== 'limpeza') {
            setRefreshKey((k) => k + 1);
        }
    }

    return (
        <div className="app-shell">
            <header className="fascia">
                <div className="fascia__brand">
                    <img src={logo} className="fascia__logo" alt="" aria-hidden="true" />
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
                    {activeTab === 'portas' && (
                        <div className="port-search">
                            <SearchIcon size={14} className="port-search__icon" />
                            <input
                                type="text"
                                inputMode="numeric"
                                className="port-search__input"
                                placeholder="Buscar porta"
                                value={portSearch}
                                onChange={(e) => handlePortSearchChange(e.target.value)}
                                aria-label="Buscar por número da porta"
                            />
                            {portSearch && (
                                <button
                                    className="port-search__clear"
                                    onClick={() => setPortSearch('')}
                                    title="Limpar busca"
                                    aria-label="Limpar busca"
                                >
                                    <CloseIcon size={11} />
                                </button>
                            )}
                        </div>
                    )}
                    <div
                        className="port-counter"
                        title={
                            activeTab === 'limpeza'
                                ? 'Categorias selecionadas para limpeza'
                                : activeTab === 'portas'
                                  ? 'Processos listados agora'
                                  : `${TAB_LABELS[activeTab]} listadas agora`
                        }
                    >
                        <span className={`port-counter__value${tick ? ' port-counter__value--tick' : ''}`}>
                            {activeCount}
                        </span>
                        <span className="port-counter__label">
                            {activeTab === 'limpeza' ? 'Selecionadas' : TAB_LABELS[activeTab]}
                        </span>
                    </div>
                    <button
                        className={`refresh-btn${loading && activeTab === 'portas' ? ' refresh-btn--loading' : ''}`}
                        onClick={handleRefresh}
                        disabled={(loading && activeTab === 'portas') || activeTab === 'limpeza'}
                        title={
                            activeTab === 'limpeza'
                                ? 'Nada para atualizar aqui'
                                : loading && activeTab === 'portas'
                                  ? 'Atualizando...'
                                  : 'Atualizar'
                        }
                        aria-label={loading && activeTab === 'portas' ? 'Atualizando' : 'Atualizar'}
                    >
                        <RefreshIcon />
                    </button>
                </div>
            </header>

            <div className={`workspace${logsTarget ? ' workspace--logs' : ''}`}>
                <main className={`instrument-panel${logsTarget && logsPrefs.expanded ? ' instrument-panel--hidden' : ''}`}>
                    {activeTab === 'portas' && (
                        <PortsTable
                            ports={filteredPorts}
                            searchQuery={portSearch}
                            onKill={handleKill}
                            onKillParent={handleKillParent}
                            portOwners={portOwners}
                            onOpenLogs={openLogs}
                            killingPid={killingPid}
                            coolingPid={coolingPid}
                            error={error}
                        />
                    )}
                    {activeTab === 'containers' && (
                        <ContainersTable
                            key={refreshKey}
                            activeLogsId={logsTarget?.id ?? null}
                            onOpenLogs={openLogs}
                            onCountChange={(n) => setCounts((prev) => ({ ...prev, containers: n }))}
                        />
                    )}
                    {activeTab === 'imagens' && (
                        <ImagesTable
                            key={refreshKey}
                            onCountChange={(n) => setCounts((prev) => ({ ...prev, imagens: n }))}
                        />
                    )}
                    {activeTab === 'limpeza' && (
                        <CleanupPanel onCountChange={(n) => setCounts((prev) => ({ ...prev, limpeza: n }))} />
                    )}
                </main>
                {logsTarget && (
                    <LogsDrawer
                        key={logsTarget.id}
                        target={logsTarget}
                        prefs={logsPrefs}
                        onPrefsChange={updateLogsPrefs}
                        onClose={closeLogs}
                    />
                )}
            </div>
        </div>
    );
}

export default App;

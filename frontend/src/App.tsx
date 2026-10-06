import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import './App.css';
import { KillProcess, ListContainers, ListPortOwners, ListPorts } from '../wailsjs/go/main/App';
import { ports } from '../wailsjs/go/models';
import PortsTable from './components/PortsTable';
import ContainersTable from './components/ContainersTable';
import ImagesTable from './components/ImagesTable';
import CleanupTab from './components/CleanupTab';
import SshTab, { type TerminalRequest } from './components/SshTab';
import HostGroup from './components/HostGroup';
import RemotePortsSection from './components/RemotePortsSection';
import RemoteContainersSection from './components/RemoteContainersSection';
import RemoteImagesSection from './components/RemoteImagesSection';
import LogsDrawer, { type LogsTarget } from './components/LogsDrawer';
import { useLogsPrefs } from './useLogsPrefs';
import { useSshHosts } from './useSshHosts';
import { connInfo, useSshConnections } from './useSshConnections';
import { useSshConnect } from './useSshConnect';
import { useTunnels } from './useTunnels';
import { useSavedTunnels } from './useSavedTunnels';
import { useTunnelControl } from './useTunnelControl';
import { useNameLabel } from './containerName';
import { RefreshIcon, SearchIcon, CloseIcon } from './components/icons';
import { useConfirm } from './components/ConfirmDialog';
import logo from './assets/images/localhub-logo.svg';

const COOL_DOWN_MS = 340;

// The header search box changes meaning with the tab; each tab keeps its own text.
const SEARCH_UI = {
    portas: { placeholder: 'Buscar porta ou processo', label: 'Buscar por número da porta ou nome do processo' },
    containers: { placeholder: 'Buscar nome ou ID', label: 'Buscar containers por nome ou ID' },
    imagens: { placeholder: 'Buscar nome, tag ou ID', label: 'Buscar imagens por nome, tag ou ID' },
} as const;

type Tab = 'portas' | 'containers' | 'imagens' | 'limpeza' | 'ssh';

const TAB_LABELS: Record<Tab, string> = {
    portas: 'Processos',
    containers: 'Containers',
    imagens: 'Imagens',
    limpeza: 'Limpeza',
    ssh: 'Servidores',
};

function App() {
    const confirm = useConfirm();
    const [activeTab, setActiveTab] = useState<Tab>('portas');
    const [counts, setCounts] = useState<Record<Tab, number>>({ portas: 0, containers: 0, imagens: 0, limpeza: 0, ssh: 0 });
    const [refreshKey, setRefreshKey] = useState(0);

    const sshHosts = useSshHosts();
    const sshConnections = useSshConnections();
    const connectFlow = useSshConnect(sshConnections, sshHosts.hosts);
    const tunnels = useTunnels();
    const savedTunnels = useSavedTunnels(sshHosts.hosts.map((h) => h.id));
    const tunnelControl = useTunnelControl(savedTunnels.saved, tunnels, sshConnections.conns);
    const names = useNameLabel();
    const [terminalRequest, setTerminalRequest] = useState<TerminalRequest | null>(null);
    // Servers with a group in the data tabs, and what each one reported per tab.
    const remoteHosts = sshHosts.hosts.filter((h) => sshConnections.tracked[h.id]);
    const [remoteCounts, setRemoteCounts] = useState<Record<string, Record<string, number>>>({});
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [hintDismissed, setHintDismissed] = useState(false);
    // The SSH tab stays mounted once opened, so open terminals survive tab switches.
    const [sshMounted, setSshMounted] = useState(false);

    const [portList, setPortList] = useState<ports.PortInfo[]>([]);
    const [portSearch, setPortSearch] = useState('');
    const [containerSearch, setContainerSearch] = useState('');
    const [imageSearch, setImageSearch] = useState('');
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
        (id: string, name: string, label?: string) => {
            setLogsTarget({ id, name, label });
            updateLogsPrefs({ container: name });
        },
        [updateLogsPrefs]
    );

    // Remote containers are not remembered across sessions (the server may not
    // be connected next time), so the saved "container left open" stays local.
    const openRemoteLogs = useCallback((hostId: string, hostName: string, id: string, name: string, label?: string) => {
        setLogsTarget({ id, name, label, hostId, hostName });
    }, []);

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

    const searchValue =
        activeTab === 'containers' ? containerSearch : activeTab === 'imagens' ? imageSearch : portSearch;
    const setSearchValue =
        activeTab === 'containers' ? setContainerSearch : activeTab === 'imagens' ? setImageSearch : setPortSearch;
    const remoteTotal = (tab: 'portas' | 'containers' | 'imagens') =>
        remoteHosts.reduce(
            (sum, h) =>
                sum + (connInfo(sshConnections.conns, h.id).state === 'connected' ? (remoteCounts[tab]?.[h.id] ?? 0) : 0),
            0
        );
    const activeCount =
        activeTab === 'ssh'
            ? sshHosts.hosts.length
            : activeTab === 'portas' || activeTab === 'containers' || activeTab === 'imagens'
              ? counts[activeTab] + remoteTotal(activeTab)
              : counts[activeTab];
    // Matches the port number or the process name (case-insensitive). A row
    // that belongs to a Docker container also matches its container name,
    // since that name is shown on the row.
    const query = portSearch.trim().toLowerCase();
    const filteredPorts = query
        ? portList.filter(
              (p) =>
                  String(p.port).includes(query) ||
                  p.processName.toLowerCase().includes(query) ||
                  (portOwners[`${p.protocol}:${p.port}`]?.name.toLowerCase().includes(query) ?? false)
          )
        : portList;

    function reportRemoteCount(tab: 'portas' | 'containers' | 'imagens', hostId: string, n: number) {
        setRemoteCounts((prev) =>
            prev[tab]?.[hostId] === n ? prev : { ...prev, [tab]: { ...prev[tab], [hostId]: n } }
        );
    }

    // From the SSH tab: open a data tab and scroll to one server's section.
    function openServerTab(tab: 'portas' | 'containers' | 'imagens', hostId: string) {
        setActiveTab(tab);
        window.setTimeout(() => jumpToGroup(`${tab}:${hostId}`), 300);
    }

    // The "Terminal" button of a server's container: the terminal lives in the Servidores tab.
    function openContainerTerminal(hostId: string, container: { id: string; name: string }) {
        setSshMounted(true);
        setActiveTab('ssh');
        setTerminalRequest({ nonce: Date.now(), hostId, container });
    }

    function toggleGroup(key: string) {
        setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
    }

    // With a long local list the servers' sections sit far below the fold; the
    // jump strip brings the user to one (expanding it if it was collapsed).
    function jumpToGroup(key: string) {
        setCollapsed((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
        requestAnimationFrame(() =>
            document.getElementById(`hg-${key}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        );
    }

    /**
     * "Esta máquina" plus one section per connected server. With no server
     * connected the header is hidden and the local content is the whole tab.
     */
    function renderGroups(tab: 'portas' | 'containers' | 'imagens', local: ReactNode) {
        const showHeaders = remoteHosts.length > 0;
        // Servers are saved but none is connected: say where remote data comes from.
        const showHint = !showHeaders && sshHosts.hosts.length > 0 && !hintDismissed;
        return (
            <>
                {showHint && (
                    <p className="host-hint" role="note">
                        <span>
                            Para ver processos, containers e imagens de um servidor SSH aqui, conecte-o na aba Servidores.
                        </span>
                        <button className="action-key" onClick={() => setActiveTab('ssh')}>
                            Ir para Servidores
                        </button>
                        <button
                            className="ssh-notice__close"
                            onClick={() => setHintDismissed(true)}
                            aria-label="Dispensar dica"
                        >
                            <CloseIcon size={11} />
                        </button>
                    </p>
                )}
                {showHeaders && (
                    <nav className="host-jump" aria-label="Ir para a máquina">
                        <button className="host-jump__btn" onClick={() => jumpToGroup(`${tab}:local`)}>
                            Esta máquina
                            <span className="host-jump__count">{counts[tab]}</span>
                        </button>
                        {remoteHosts.map((h) => {
                            const info = connInfo(sshConnections.conns, h.id);
                            const down = info.state !== 'connected';
                            const n = remoteCounts[tab]?.[h.id];
                            return (
                                <button
                                    key={h.id}
                                    className="host-jump__btn host-jump__btn--remote"
                                    onClick={() => jumpToGroup(`${tab}:${h.id}`)}
                                >
                                    {h.name}
                                    <span className="host-jump__count">
                                        {down ? 'desconectado' : typeof n === 'number' ? n : '…'}
                                    </span>
                                </button>
                            );
                        })}
                    </nav>
                )}
                <HostGroup
                    id={`hg-${tab}:local`}
                    title="Esta máquina"
                    remote={false}
                    showHeader={showHeaders}
                    collapsed={!!collapsed[`${tab}:local`]}
                    onToggle={() => toggleGroup(`${tab}:local`)}
                    count={counts[tab]}
                >
                    {local}
                </HostGroup>
                {remoteHosts.map((h) => {
                    const info = connInfo(sshConnections.conns, h.id);
                    const connected = info.state === 'connected';
                    const key = `${tab}:${h.id}`;
                    return (
                        <HostGroup
                            key={h.id}
                            id={`hg-${key}`}
                            title={h.name}
                            remote
                            subtitle={`${h.user}@${h.address}`}
                            showHeader
                            collapsed={!!collapsed[key]}
                            onToggle={() => toggleGroup(key)}
                            count={remoteCounts[tab]?.[h.id] ?? null}
                            disconnected={!connected}
                            message={info.message}
                            reconnecting={info.state === 'connecting'}
                            onReconnect={() => connectFlow.connectHost(h)}
                        >
                            {tab === 'portas' && (
                                <RemotePortsSection
                                    hostId={h.id}
                                    hostName={h.name}
                                    refreshKey={refreshKey}
                                    query={portSearch}
                                    onCount={(n) => reportRemoteCount('portas', h.id, n)}
                                />
                            )}
                            {tab === 'containers' && (
                                <RemoteContainersSection
                                    query={containerSearch}
                                    names={names}
                                    host={h}
                                    tunnels={tunnels}
                                    hostId={h.id}
                                    hostName={h.name}
                                    refreshKey={refreshKey}
                                    onCount={(n) => reportRemoteCount('containers', h.id, n)}
                                    onOpenLogs={(id, name, label) => openRemoteLogs(h.id, h.name, id, name, label)}
                                    onOpenTerminal={(c) => openContainerTerminal(h.id, c)}
                                    activeLogsId={logsTarget?.hostId === h.id ? logsTarget.id : null}
                                />
                            )}
                            {tab === 'imagens' && (
                                <RemoteImagesSection
                                    query={imageSearch}
                                    hostId={h.id}
                                    hostName={h.name}
                                    refreshKey={refreshKey}
                                    onCount={(n) => reportRemoteCount('imagens', h.id, n)}
                                />
                            )}
                        </HostGroup>
                    );
                })}
            </>
        );
    }

    function handleRefresh() {
        if (activeTab === 'portas') {
            loadPorts();
            setRefreshKey((k) => k + 1); // reloads the remote sections too
        } else if (activeTab !== 'limpeza' && activeTab !== 'ssh') {
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
                            onClick={() => {
                                if (tab === 'ssh') setSshMounted(true);
                                setActiveTab(tab);
                            }}
                        >
                            {TAB_LABELS[tab]}
                        </button>
                    ))}
                </nav>

                <div className="fascia__controls">
                    {(activeTab === 'portas' || activeTab === 'containers' || activeTab === 'imagens') && (
                        <div className="port-search">
                            <SearchIcon size={14} className="port-search__icon" />
                            <input
                                type="text"
                                className="port-search__input"
                                placeholder={SEARCH_UI[activeTab].placeholder}
                                value={searchValue}
                                onChange={(e) => setSearchValue(e.target.value)}
                                aria-label={SEARCH_UI[activeTab].label}
                            />
                            {searchValue && (
                                <button
                                    className="port-search__clear"
                                    onClick={() => setSearchValue('')}
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
                                ? 'Itens selecionados para limpeza'
                                : activeTab === 'ssh'
                                  ? 'Servidores salvos'
                                  : activeTab === 'portas'
                                  ? 'Processos listados agora'
                                  : `${TAB_LABELS[activeTab]} listadas agora`
                        }
                    >
                        <span className={`port-counter__value${tick ? ' port-counter__value--tick' : ''}`}>
                            {activeCount}
                        </span>
                        <span className="port-counter__label">
                            {activeTab === 'limpeza' ? 'Selecionadas' : activeTab === 'ssh' ? 'Servidores' : TAB_LABELS[activeTab]}
                        </span>
                    </div>
                    <button
                        className={`refresh-btn${loading && activeTab === 'portas' ? ' refresh-btn--loading' : ''}`}
                        onClick={handleRefresh}
                        disabled={(loading && activeTab === 'portas') || activeTab === 'limpeza' || activeTab === 'ssh'}
                        title={
                            activeTab === 'limpeza' || activeTab === 'ssh'
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
                    {activeTab === 'portas' &&
                        renderGroups(
                            'portas',
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
                    {activeTab === 'containers' &&
                        renderGroups(
                            'containers',
                            <ContainersTable
                                query={containerSearch}
                                names={names}
                                key={refreshKey}
                                activeLogsId={logsTarget && !logsTarget.hostId ? logsTarget.id : null}
                                onOpenLogs={openLogs}
                                onCountChange={(n) => setCounts((prev) => ({ ...prev, containers: n }))}
                            />
                        )}
                    {activeTab === 'imagens' &&
                        renderGroups(
                            'imagens',
                            <ImagesTable
                                query={imageSearch}
                                key={refreshKey}
                                onCountChange={(n) => setCounts((prev) => ({ ...prev, imagens: n }))}
                            />
                        )}
                    {activeTab === 'limpeza' && (
                        <CleanupTab onCountChange={(n) => setCounts((prev) => ({ ...prev, limpeza: n }))} />
                    )}
                    {sshMounted && (
                        <div className="ssh-host" hidden={activeTab !== 'ssh'}>
                            <SshTab
                                hostsApi={sshHosts}
                                connections={sshConnections}
                                connectFlow={connectFlow}
                                tunnels={tunnels}
                                savedTunnels={savedTunnels}
                                tunnelControl={tunnelControl}
                                request={terminalRequest}
                                onRequestHandled={() => setTerminalRequest(null)}
                                onOpenServerTab={openServerTab}
                                visible={activeTab === 'ssh'}
                            />
                        </div>
                    )}
                </main>
                {logsTarget && (
                    <LogsDrawer
                        key={`${logsTarget.hostId ?? 'local'}:${logsTarget.id}`}
                        target={logsTarget}
                        prefs={logsPrefs}
                        onPrefsChange={updateLogsPrefs}
                        onClose={closeLogs}
                    />
                )}
            </div>
            {connectFlow.dialogs}
        </div>
    );
}

export default App;

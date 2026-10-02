import { useEffect, useMemo, useRef, useState } from 'react';
import SshHostDialog from './SshHostDialog';
import SshImportDialog from './SshImportDialog';
import SshTerminal from './SshTerminal';
import { useConfirm } from './ConfirmDialog';
import { AlertIcon, ChevronIcon, CloseIcon, SearchIcon, ServerIcon } from './icons';
import { connInfo, type SshConnectionsApi } from '../useSshConnections';
import type { SshHost, SshHostsApi } from '../useSshHosts';
import type { SshConnectApi } from '../useSshConnect';
import type { ssh } from '../../wailsjs/go/models';

interface SshTabProps {
    hostsApi: SshHostsApi;
    connections: SshConnectionsApi;
    /** Connection flow (with its dialogs) owned by the app root. */
    connectFlow: SshConnectApi;
    /** Opens a data tab (Processos, Containers, Imagens) scrolled to this server's section. */
    onOpenServerTab: (tab: ServerTab, hostId: string) => void;
    /** Open tunnels, to warn that disconnecting closes them. */
    tunnels: ssh.TunnelInfo[];
    /** The SSH tab is the one on screen (the component stays mounted to keep terminals alive). */
    visible: boolean;
}

type View = 'list' | 'terminal';

export type ServerTab = 'portas' | 'containers' | 'imagens';

const SERVER_TABS: Array<{ tab: ServerTab; label: string }> = [
    { tab: 'portas', label: 'Processos' },
    { tab: 'containers', label: 'Containers' },
    { tab: 'imagens', label: 'Imagens' },
];

const STATE_LABEL = { connecting: 'Conectando', connected: 'Conectado', disconnected: '' } as const;

function SshTab({ hostsApi, connections, connectFlow, onOpenServerTab, tunnels, visible }: SshTabProps) {
    const confirm = useConfirm();
    const { hosts, add, update, remove, addMany } = hostsApi;
    const { conns, disconnect } = connections;

    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState<SshHost | 'new' | null>(null);
    const [importing, setImporting] = useState(false);
    const [notice, setNotice] = useState('');
    const [info, setInfo] = useState('');
    // The server that just connected, to point the user at where its data shows up.
    const [justConnected, setJustConnected] = useState<{ id: string; name: string } | null>(null);

    const [view, setView] = useState<View>('list');
    const [terminalHostId, setTerminalHostId] = useState<string | null>(null);
    const [terminalRun, setTerminalRun] = useState(0);
    const [terminalEnded, setTerminalEnded] = useState(false);

    const terminalHost = hosts.find((h) => h.id === terminalHostId) ?? null;

    // A server removed while its terminal is open can't be (the row blocks it),
    // but guard the state anyway.
    useEffect(() => {
        if (terminalHostId && !terminalHost) {
            setTerminalHostId(null);
            setView('list');
        }
    }, [terminalHostId, terminalHost]);

    // Surface why a connection failed or dropped, once per distinct message.
    const lastNotified = useRef<Record<string, string>>({});
    useEffect(() => {
        for (const h of hosts) {
            const info = connInfo(conns, h.id);
            if (info.state === 'disconnected' && info.message && lastNotified.current[h.id] !== info.message) {
                lastNotified.current[h.id] = info.message;
                setNotice(`${h.name}: ${info.message}`);
            }
            if (info.state === 'connected') delete lastNotified.current[h.id];
        }
    }, [conns, hosts]);

    // Say where the server's data is whenever one connects, whichever way it was started.
    const prevStates = useRef<Record<string, string>>({});
    useEffect(() => {
        for (const h of hosts) {
            const now = connInfo(conns, h.id).state;
            if (now === 'connected' && prevStates.current[h.id] !== 'connected') {
                setJustConnected({ id: h.id, name: h.name });
            }
            prevStates.current[h.id] = now;
        }
        setJustConnected((j) => (j && connInfo(conns, j.id).state !== 'connected' ? null : j));
    }, [conns, hosts]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return hosts;
        return hosts.filter(
            (h) =>
                h.name.toLowerCase().includes(q) ||
                h.address.toLowerCase().includes(q) ||
                h.user.toLowerCase().includes(q)
        );
    }, [hosts, query]);

    /** Connects (the passphrase and host-key dialogs come from the app root). */
    function connectHost(host: SshHost, openTerminal: boolean): Promise<boolean> {
        setNotice('');
        return connectFlow.connectHost(host, openTerminal ? () => startTerminal(host) : undefined);
    }

    function startTerminal(host: SshHost) {
        setTerminalHostId(host.id);
        setTerminalEnded(false);
        setTerminalRun((n) => n + 1);
        setView('terminal');
    }

    async function handleOpenTerminal(host: SshHost) {
        if (terminalHostId === host.id) {
            setView('terminal');
            return;
        }
        if (terminalHostId && terminalHost) {
            const ok = await confirm(
                `Já existe um terminal aberto em "${terminalHost.name}". Fechá-lo e abrir um em "${host.name}"?`
            );
            if (!ok) return;
        }
        if (connInfo(conns, host.id).state === 'connected') startTerminal(host);
        else await connectHost(host, true);
    }

    async function handleDisconnect(host: SshHost) {
        const effects: string[] = [];
        if (terminalHostId === host.id && !terminalEnded) effects.push('encerra o terminal aberto');
        const nTunnels = tunnels.filter((t) => t.hostId === host.id).length;
        if (nTunnels > 0) effects.push(`fecha ${nTunnels} ${nTunnels === 1 ? 'túnel aberto' : 'túneis abertos'}`);
        if (effects.length > 0) {
            const ok = await confirm(`Desconectar de "${host.name}" ${effects.join(' e ')}. Continuar?`);
            if (!ok) return;
        }
        disconnect(host.id);
    }

    async function handleDelete(host: SshHost) {
        const ok = await confirm(`Excluir o servidor "${host.name}" da lista? Isso não afeta a máquina remota.`);
        if (ok) remove(host.id);
    }

    function closeTerminal() {
        setTerminalHostId(null);
        setTerminalEnded(false);
        setView('list');
    }

    function saveHost(draft: Omit<SshHost, 'id'>) {
        if (editing && editing !== 'new') update(editing.id, draft);
        else add(draft);
        setEditing(null);
    }

    const termInfo = terminalHost ? connInfo(conns, terminalHost.id) : null;

    return (
        <div className="ssh-tab">
            {notice && (
                <p className="alert" role="alert">
                    <AlertIcon size={15} />
                    <span className="ssh-notice__text">{notice}</span>
                    <button className="ssh-notice__close" onClick={() => setNotice('')} aria-label="Dispensar aviso">
                        <CloseIcon size={11} />
                    </button>
                </p>
            )}

            {justConnected && (
                <div className="ssh-info ssh-info--connected" role="status">
                    <span>
                        <strong>{justConnected.name}</strong> conectado. Veja os dados dele nas abas:
                    </span>
                    <span className="ssh-info__links">
                        {SERVER_TABS.map(({ tab, label }) => (
                            <button
                                key={tab}
                                className="action-key"
                                onClick={() => onOpenServerTab(tab, justConnected.id)}
                            >
                                {label}
                            </button>
                        ))}
                    </span>
                    <button className="ssh-notice__close" onClick={() => setJustConnected(null)} aria-label="Dispensar aviso">
                        <CloseIcon size={11} />
                    </button>
                </div>
            )}

            {info && (
                <p className="ssh-info" role="status">
                    <span>{info}</span>
                    <button className="ssh-notice__close" onClick={() => setInfo('')} aria-label="Dispensar aviso">
                        <CloseIcon size={11} />
                    </button>
                </p>
            )}

            <div className="ssh-list-view" hidden={view !== 'list'}>
                {hosts.length === 0 ? (
                    <div className="empty-state">
                        <ServerIcon />
                        <p>Nenhum servidor cadastrado.</p>
                        <div className="row-actions">
                            <button className="action-key ssh-primary" onClick={() => setEditing('new')}>
                                Adicionar servidor
                            </button>
                            <button className="action-key" onClick={() => setImporting(true)}>
                                Importar do SSH config
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="ssh-toolbar">
                            <div className="port-search ssh-toolbar__search">
                                <SearchIcon size={14} className="port-search__icon" />
                                <input
                                    type="text"
                                    className="port-search__input"
                                    placeholder="Buscar servidor"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    aria-label="Buscar servidor por nome, endereço ou usuário"
                                />
                                {query && (
                                    <button
                                        className="port-search__clear"
                                        onClick={() => setQuery('')}
                                        title="Limpar busca"
                                        aria-label="Limpar busca"
                                    >
                                        <CloseIcon size={11} />
                                    </button>
                                )}
                            </div>
                            <div className="ssh-toolbar__actions">
                                <button className="action-key" onClick={() => setImporting(true)}>
                                    Importar do SSH config
                                </button>
                                <button className="action-key ssh-primary" onClick={() => setEditing('new')}>
                                    Novo servidor
                                </button>
                            </div>
                        </div>

                        {filtered.length === 0 ? (
                            <div className="empty-state">
                                <SearchIcon size={32} />
                                <p>Nenhum servidor corresponde à busca.</p>
                            </div>
                        ) : (
                            <table className="ssh-table">
                                <thead>
                                    <tr>
                                        <th>Servidor</th>
                                        <th>Endereço</th>
                                        <th>Login</th>
                                        <th>Estado</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((h) => {
                                        const info = connInfo(conns, h.id);
                                        const connected = info.state === 'connected';
                                        const connecting = info.state === 'connecting';
                                        const hasTerminal = terminalHostId === h.id;
                                        return (
                                            <tr key={h.id} className="ssh-row">
                                                <td className="ssh-row__name">{h.name}</td>
                                                <td className="ssh-row__addr" data-label="Endereço">
                                                    {h.user}@{h.address}
                                                    {h.port !== 22 ? `:${h.port}` : ''}
                                                </td>
                                                <td className="ssh-row__method" data-label="Login">
                                                    {h.method === 'key' ? 'Chave' : 'ssh-agent'}
                                                </td>
                                                <td data-label="Estado">
                                                    {info.state !== 'disconnected' && (
                                                        <span
                                                            className={`status-chip${connected ? ' status-chip--listen' : ''}`}
                                                        >
                                                            {STATE_LABEL[info.state]}
                                                        </span>
                                                    )}
                                                    {connected && (
                                                        <div className="ssh-row__views" aria-label="Ver os dados deste servidor">
                                                            {SERVER_TABS.map(({ tab, label }) => (
                                                                <button
                                                                    key={tab}
                                                                    className="ssh-link"
                                                                    onClick={() => onOpenServerTab(tab, h.id)}
                                                                    title={`Ver ${label.toLowerCase()} de ${h.name}`}
                                                                >
                                                                    {label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="row-actions ssh-row__actions">
                                                        {connected ? (
                                                            <>
                                                                <button
                                                                    className="action-key ssh-primary"
                                                                    onClick={() => handleOpenTerminal(h)}
                                                                >
                                                                    {hasTerminal ? 'Voltar ao terminal' : 'Abrir terminal'}
                                                                </button>
                                                                <button
                                                                    className="action-key"
                                                                    onClick={() => handleDisconnect(h)}
                                                                >
                                                                    Desconectar
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    className="action-key ssh-primary"
                                                                    disabled={connecting}
                                                                    onClick={() => connectHost(h, false)}
                                                                >
                                                                    {connecting ? 'Conectando' : 'Conectar'}
                                                                </button>
                                                                <button
                                                                    className="action-key"
                                                                    disabled={connecting}
                                                                    onClick={() => handleOpenTerminal(h)}
                                                                >
                                                                    Terminal
                                                                </button>
                                                            </>
                                                        )}
                                                        <button
                                                            className="action-key"
                                                            disabled={connected || connecting}
                                                            title={connected ? 'Desconecte para editar' : 'Editar'}
                                                            onClick={() => setEditing(h)}
                                                        >
                                                            Editar
                                                        </button>
                                                        <button
                                                            className="kill-key"
                                                            disabled={connected || connecting}
                                                            title={connected ? 'Desconecte para excluir' : 'Excluir'}
                                                            onClick={() => handleDelete(h)}
                                                        >
                                                            Excluir
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </>
                )}
            </div>

            {terminalHost && (
                <div className="ssh-terminal-view" hidden={view !== 'terminal'}>
                    <div className="ssh-terminal-bar">
                        <button className="action-key" onClick={() => setView('list')}>
                            <ChevronIcon size={12} className="ssh-back-icon" /> Servidores
                        </button>
                        <div className="ssh-terminal-bar__id">
                            <span className="ssh-terminal-bar__name">{terminalHost.name}</span>
                            <span className="ssh-terminal-bar__addr">
                                {terminalHost.user}@{terminalHost.address}
                            </span>
                        </div>
                        <span
                            className={`status-chip${termInfo?.state === 'connected' && !terminalEnded ? ' status-chip--listen' : ''}`}
                        >
                            {terminalEnded ? 'Encerrado' : termInfo ? STATE_LABEL[termInfo.state] || 'Desconectado' : ''}
                        </span>
                        <div className="row-actions ssh-terminal-bar__actions">
                            {terminalEnded && termInfo?.state === 'connected' && (
                                <button className="action-key ssh-primary" onClick={() => startTerminal(terminalHost)}>
                                    Reabrir
                                </button>
                            )}
                            <button className="action-key" onClick={closeTerminal}>
                                Fechar terminal
                            </button>
                            {termInfo?.state === 'connected' && (
                                <button className="kill-key" onClick={() => handleDisconnect(terminalHost)}>
                                    Desconectar
                                </button>
                            )}
                        </div>
                    </div>
                    <SshTerminal
                        key={`${terminalHost.id}:${terminalRun}`}
                        host={terminalHost}
                        visible={visible && view === 'terminal'}
                        onEnded={() => setTerminalEnded(true)}
                    />
                </div>
            )}

            {editing && (
                <SshHostDialog
                    initial={editing === 'new' ? undefined : editing}
                    onSave={saveHost}
                    onCancel={() => setEditing(null)}
                />
            )}

            {importing && (
                <SshImportDialog
                    existing={hosts}
                    onCancel={() => setImporting(false)}
                    onImport={(drafts) => {
                        const n = addMany(drafts);
                        setImporting(false);
                        setView('list');
                        setNotice('');
                        setInfo(
                            n > 0
                                ? `${n} servidor${n === 1 ? '' : 'es'} importado${n === 1 ? '' : 's'} do ~/.ssh/config.`
                                : 'Nenhum servidor novo para importar.'
                        );
                    }}
                />
            )}

        </div>
    );
}

export default SshTab;

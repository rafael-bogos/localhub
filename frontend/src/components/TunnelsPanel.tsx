import { useState } from 'react';
import { RemoteCloseTunnel } from '../../wailsjs/go/main/App';
import { ssh } from '../../wailsjs/go/models';
import TunnelFormDialog from './TunnelFormDialog';
import { useConfirm } from './ConfirmDialog';
import { connInfo, type ConnInfo } from '../useSshConnections';
import type { SshHost } from '../useSshHosts';
import type { SavedTunnel, SavedTunnelsApi } from '../useSavedTunnels';
import type { TunnelControl } from '../useTunnelControl';

interface TunnelsPanelProps {
    hosts: SshHost[];
    conns: Record<string, ConnInfo>;
    tunnelsApi: SavedTunnelsApi;
    /** Every open tunnel (saved ones and those opened from a container). */
    live: ssh.TunnelInfo[];
    control: TunnelControl;
}

type FormState = { hostId: string; initial?: SavedTunnel } | null;

/**
 * Tunnels per server, in the Servidores tab: each connected server lists its
 * saved tunnels (name, local port, destination) to open and close with a click,
 * plus the tunnels opened from its containers.
 */
function TunnelsPanel({ hosts, conns, tunnelsApi, live, control }: TunnelsPanelProps) {
    const confirm = useConfirm();
    const [form, setForm] = useState<FormState>(null);

    // A server shows up when it is connected or has anything to show.
    const groups = hosts.filter(
        (h) =>
            connInfo(conns, h.id).state === 'connected' ||
            tunnelsApi.saved.some((t) => t.hostId === h.id) ||
            live.some((l) => l.hostId === h.id)
    );

    async function remove(t: SavedTunnel) {
        if (!(await confirm(`Excluir o túnel "${t.name}" (${t.localPort} → ${t.remoteHost}:${t.remotePort})?`))) return;
        control.close(t);
        tunnelsApi.remove(t.id);
    }

    return (
        <section className="tunnels-panel" aria-label="Túneis">
            <h2 className="tunnels-panel__title">Túneis</h2>

            {groups.length === 0 && (
                <p className="host-group__note">
                    Conecte um servidor para criar túneis: uma porta neste computador que leva a um IP e uma porta da rede do
                    servidor.
                </p>
            )}

            {groups.map((h) => {
                const connected = connInfo(conns, h.id).state === 'connected';
                const mine = tunnelsApi.saved.filter((t) => t.hostId === h.id);
                const fromContainers = live.filter((l) => l.hostId === h.id && l.kind !== 'forward');
                return (
                    <div key={h.id} className="tunnel-group">
                        <div className="host-group__header tunnel-group__header">
                            <span className="host-group__title">{h.name}</span>
                            <span className={`status-chip${connected ? ' status-chip--listen' : ''}`}>
                                {connected ? 'Conectado' : 'Desconectado'}
                            </span>
                            <span className="host-group__spacer" />
                            <button className="action-key" onClick={() => setForm({ hostId: h.id })}>
                                Novo túnel
                            </button>
                        </div>

                        {mine.length === 0 && fromContainers.length === 0 && (
                            <p className="host-group__note">
                                {connected
                                    ? 'Nenhum túnel neste servidor. Crie um para alcançar um banco ou serviço da rede privada dele.'
                                    : 'Nenhum túnel salvo para este servidor.'}
                            </p>
                        )}

                        {(mine.length > 0 || fromContainers.length > 0) && (
                            <table className="remote-table tunnel-table">
                                <thead>
                                    <tr>
                                        <th>Nome</th>
                                        <th>Neste computador</th>
                                        <th>Destino</th>
                                        <th>Estado</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mine.map((t) => {
                                        const l = control.liveFor(t);
                                        const opening = control.busy.has(t.id);
                                        const err = control.errors[t.id];
                                        return (
                                            <tr key={t.id} className="container-row tunnel-row">
                                                <td className="container-row__name">
                                                    {t.name}
                                                    {t.autoOpen && (
                                                        <span className="container-row__compose">abre ao conectar</span>
                                                    )}
                                                </td>
                                                <td className="tunnel-row__addr" data-label="Neste computador">
                                                    127.0.0.1:{t.localPort}
                                                </td>
                                                <td className="tunnel-row__addr" data-label="Destino">
                                                    {t.remoteHost}:{t.remotePort}
                                                </td>
                                                <td data-label="Estado">
                                                    <span className={`status-chip${l ? ' status-chip--listen' : ''}`}>
                                                        {opening ? 'Abrindo' : l ? 'Aberto' : 'Fechado'}
                                                    </span>
                                                    {err && (
                                                        <span className="tunnel-row__error" role="alert">
                                                            {err}
                                                        </span>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="row-actions">
                                                        {l ? (
                                                            <button className="action-key" onClick={() => control.close(t)}>
                                                                Fechar
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="action-key ssh-primary"
                                                                disabled={!connected || opening}
                                                                title={connected ? 'Abrir o túnel' : 'Conecte o servidor para abrir o túnel'}
                                                                onClick={() => control.open(t)}
                                                            >
                                                                {opening ? 'Abrindo' : 'Abrir'}
                                                            </button>
                                                        )}
                                                        <button
                                                            className="action-key"
                                                            disabled={Boolean(l)}
                                                            title={l ? 'Feche o túnel para editar' : 'Editar'}
                                                            onClick={() => setForm({ hostId: h.id, initial: t })}
                                                        >
                                                            Editar
                                                        </button>
                                                        <button className="kill-key" onClick={() => remove(t)}>
                                                            Excluir
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {fromContainers.map((l) => (
                                        <tr key={l.id} className="container-row tunnel-row">
                                            <td className="container-row__name">
                                                {l.containerName || 'container'}
                                                <span className="container-row__compose">aberto pela aba Containers</span>
                                            </td>
                                            <td className="tunnel-row__addr" data-label="Neste computador">
                                                {l.localAddr}
                                            </td>
                                            <td className="tunnel-row__addr" data-label="Destino">
                                                {l.remoteIp}:{l.remotePort}
                                            </td>
                                            <td data-label="Estado">
                                                <span className="status-chip status-chip--listen">Aberto</span>
                                            </td>
                                            <td>
                                                <div className="row-actions">
                                                    <button
                                                        className="action-key"
                                                        onClick={() => RemoteCloseTunnel(l.id).catch(() => {})}
                                                    >
                                                        Fechar
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                );
            })}

            {form && (
                <TunnelFormDialog
                    hosts={hosts}
                    hostId={form.hostId}
                    initial={form.initial}
                    onCancel={() => setForm(null)}
                    onSave={(draft) => {
                        if (form.initial) tunnelsApi.update(form.initial.id, draft);
                        else tunnelsApi.add(draft);
                        setForm(null);
                    }}
                />
            )}
        </section>
    );
}

export default TunnelsPanel;

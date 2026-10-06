import { useEffect, useState, type FormEvent } from 'react';
import { RemoteSuggestLocalPort } from '../../wailsjs/go/main/App';
import type { SshHost } from '../useSshHosts';
import type { SavedTunnel, SavedTunnelDraft } from '../useSavedTunnels';

interface TunnelFormDialogProps {
    hosts: SshHost[];
    /** Server preselected for a new tunnel. */
    hostId: string;
    /** Tunnel being edited; undefined creates a new one. */
    initial?: SavedTunnel;
    onSave: (draft: SavedTunnelDraft) => void;
    onCancel: () => void;
}

// An IP or a host name; the backend applies the same rule.
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$|^[0-9A-Fa-f:.]+:[0-9A-Fa-f:.]*$/;

function toPort(v: string): number {
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
}

/** Creates or edits a saved tunnel: name, local port, and the host and port it leads to. */
function TunnelFormDialog({ hosts, hostId, initial, onSave, onCancel }: TunnelFormDialogProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [server, setServer] = useState(initial?.hostId ?? hostId);
    const [localPort, setLocalPort] = useState(initial ? String(initial.localPort) : '');
    const [remoteHost, setRemoteHost] = useState(initial?.remoteHost ?? '');
    const [remotePort, setRemotePort] = useState(initial ? String(initial.remotePort) : '');
    const [autoOpen, setAutoOpen] = useState(initial?.autoOpen ?? false);
    const [localTouched, setLocalTouched] = useState(Boolean(initial));
    const [error, setError] = useState('');

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    // An old error no longer applies once the user changes a field.
    useEffect(() => {
        setError('');
    }, [name, server, localPort, remoteHost, remotePort]);

    // Suggest a free local port for the destination port, until the user types one.
    useEffect(() => {
        const p = toPort(remotePort);
        if (localTouched || !(p >= 1 && p <= 65535)) return;
        let cancelled = false;
        RemoteSuggestLocalPort(p)
            .then((s) => !cancelled && s > 0 && setLocalPort(String(s)))
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [remotePort, localTouched]);

    const host = hosts.find((h) => h.id === server);
    const lp = toPort(localPort);
    const rp = toPort(remotePort);
    const rh = remoteHost.trim();
    const sshPort = host && host.port !== 22 ? ` -p ${host.port}` : '';
    const equivalent =
        host && lp >= 1 && rp >= 1 && rh
            ? `ssh -fN -L ${lp}:${rh}:${rp} ${host.user}@${host.address}${sshPort}`
            : '';

    function submit(e: FormEvent) {
        e.preventDefault();
        if (!host) return setError('Escolha o servidor.');
        if (!name.trim()) return setError('Dê um nome ao túnel.');
        if (!(lp >= 1 && lp <= 65535)) return setError('A porta local deve estar entre 1 e 65535.');
        if (!rh || !HOST_RE.test(rh)) return setError('Informe o IP ou o nome do host de destino (sem espaços, barras ou porta).');
        if (!(rp >= 1 && rp <= 65535)) return setError('A porta de destino deve estar entre 1 e 65535.');
        onSave({ hostId: server, name: name.trim(), localPort: lp, remoteHost: rh, remotePort: rp, autoOpen });
    }

    return (
        <div className="confirm-overlay" onClick={onCancel}>
            <form
                className="confirm-modal ssh-form tunnel-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={initial ? 'Editar túnel' : 'Novo túnel'}
                onClick={(e) => e.stopPropagation()}
                onSubmit={submit}
            >
                <h2 className="ssh-form__title">{initial ? 'Editar túnel' : 'Novo túnel'}</h2>
                <p className="ssh-prompt__text">
                    Abre uma porta neste computador que leva a um IP e uma porta que <strong>o servidor</strong> alcança
                    (por exemplo, um banco na rede privada dele).
                </p>

                <label className="ssh-field">
                    <span className="ssh-field__label">Nome</span>
                    <input
                        className="ssh-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex.: Banco de produção"
                        autoFocus
                    />
                </label>

                {hosts.length > 1 && (
                    <label className="ssh-field">
                        <span className="ssh-field__label">Servidor</span>
                        <select
                            className="ssh-input"
                            value={server}
                            onChange={(e) => setServer(e.target.value)}
                            disabled={Boolean(initial)}
                        >
                            {hosts.map((h) => (
                                <option key={h.id} value={h.id}>
                                    {h.name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                <div className="ssh-form__row">
                    <label className="ssh-field ssh-field--grow">
                        <span className="ssh-field__label">IP ou host de destino</span>
                        <input
                            className="ssh-input ssh-input--mono"
                            value={remoteHost}
                            onChange={(e) => setRemoteHost(e.target.value)}
                            placeholder="172.18.3.23"
                            spellCheck={false}
                            autoCapitalize="off"
                        />
                    </label>
                    <label className="ssh-field ssh-field--port">
                        <span className="ssh-field__label">Porta</span>
                        <input
                            className="ssh-input ssh-input--mono"
                            value={remotePort}
                            onChange={(e) => setRemotePort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                            inputMode="numeric"
                            placeholder="3306"
                            aria-label="Porta de destino"
                        />
                    </label>
                </div>

                <label className="ssh-field">
                    <span className="ssh-field__label">Porta neste computador</span>
                    <input
                        className="ssh-input ssh-input--mono tunnel-dialog__port"
                        value={localPort}
                        onChange={(e) => {
                            setLocalTouched(true);
                            setLocalPort(e.target.value.replace(/\D/g, '').slice(0, 5));
                        }}
                        inputMode="numeric"
                        placeholder="33061"
                    />
                    <span className="ssh-field__hint">
                        É a porta que o seu cliente usa (127.0.0.1:porta). Só aceita conexões deste computador.
                    </span>
                </label>

                <label className="tunnel-dialog__check">
                    <input type="checkbox" checked={autoOpen} onChange={(e) => setAutoOpen(e.target.checked)} />
                    <span>Abrir sozinho quando o servidor conectar</span>
                </label>

                {equivalent && (
                    <div className="ssh-field">
                        <span className="ssh-field__label">Equivale a</span>
                        <code className="tunnel-dialog__cmd">{equivalent}</code>
                    </div>
                )}

                {error && (
                    <p className="ssh-form__error" role="alert">
                        {error}
                    </p>
                )}

                <div className="confirm-modal__actions">
                    <button type="button" className="action-key" onClick={onCancel}>
                        Cancelar
                    </button>
                    <button type="submit" className="action-key ssh-primary">
                        Salvar
                    </button>
                </div>
            </form>
        </div>
    );
}

export default TunnelFormDialog;

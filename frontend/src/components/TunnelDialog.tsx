import { useEffect, useState } from 'react';
import { RemoteContainerNetworks, RemoteOpenTunnel, RemoteSuggestLocalPort } from '../../wailsjs/go/main/App';
import { ssh } from '../../wailsjs/go/models';
import type { SshHost } from '../useSshHosts';

interface TunnelDialogProps {
    host: SshHost;
    container: { id: string; name: string };
    onClose: () => void;
}

function toPort(v: string): number {
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
}

function clean(err: unknown): string {
    return String(err).replace(/^Error:\s*/, '');
}

/**
 * Opens a local port forward to a container of a server, like
 * `ssh -fN -L 33061:172.18.3.23:3306 user@server`, without leaving the app.
 */
function TunnelDialog({ host, container, onClose }: TunnelDialogProps) {
    const [info, setInfo] = useState<ssh.ContainerNet | null>(null);
    const [loadError, setLoadError] = useState('');
    const [network, setNetwork] = useState('');
    const [remotePort, setRemotePort] = useState('');
    const [localPort, setLocalPort] = useState('');
    const [localTouched, setLocalTouched] = useState(false);
    const [error, setError] = useState('');
    const [opening, setOpening] = useState(false);
    const [opened, setOpened] = useState<ssh.TunnelInfo | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;
        RemoteContainerNetworks(host.id, container.id)
            .then((n) => {
                if (cancelled) return;
                setInfo(n);
                setNetwork(n.networks?.[0]?.name ?? '');
                const first = n.ports?.[0];
                if (first) setRemotePort(String(first));
            })
            .catch((err) => !cancelled && setLoadError(clean(err)));
        return () => {
            cancelled = true;
        };
    }, [host.id, container.id]);

    // Suggest a free local port for the chosen container port, until the user types one.
    useEffect(() => {
        const p = toPort(remotePort);
        if (localTouched || !(p >= 1 && p <= 65535)) return;
        let cancelled = false;
        RemoteSuggestLocalPort(p)
            .then((s) => !cancelled && setLocalPort(s > 0 ? String(s) : ''))
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [remotePort, localTouched]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const nets = info?.networks ?? [];
    const picked = nets.find((n) => n.name === network);
    const rp = toPort(remotePort);
    const lp = localPort.trim() === '' ? 0 : toPort(localPort);
    const sshPort = host.port !== 22 ? ` -p ${host.port}` : '';
    const equivalent =
        picked && rp >= 1
            ? `ssh -fN -L ${lp > 0 ? lp : '<porta livre>'}:${picked.ip}:${rp} ${host.user}@${host.address}${sshPort}`
            : '';

    async function open() {
        setError('');
        if (!(rp >= 1 && rp <= 65535)) return setError('Informe a porta do container (1 a 65535).');
        if (!(lp >= 0 && lp <= 65535)) return setError('A porta local deve estar entre 1 e 65535.');
        setOpening(true);
        try {
            setOpened(await RemoteOpenTunnel(host.id, container.id, network, rp, lp));
        } catch (err) {
            setError(clean(err));
        } finally {
            setOpening(false);
        }
    }

    async function copy(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard unavailable: the address is on screen to copy by hand.
        }
    }

    return (
        <div className="confirm-overlay" onClick={onClose}>
            <div
                className="confirm-modal ssh-form tunnel-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`Tunelamento para ${container.name}`}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="ssh-form__title">Tunelamento · {container.name}</h2>

                {opened ? (
                    <>
                        <p className="ssh-prompt__text">
                            Túnel aberto. Aponte seu cliente (banco de dados, navegador…) para o endereço abaixo; o
                            tráfego passa pelo servidor <strong>{host.name}</strong> até o container.
                        </p>
                        <div className="tunnel-dialog__address">
                            <code>{opened.localAddr}</code>
                            <button className="action-key" onClick={() => copy(opened.localAddr)}>
                                {copied ? 'Copiado' : 'Copiar'}
                            </button>
                        </div>
                        <p className="ssh-field__hint">
                            Leva a {opened.remoteIp}:{opened.remotePort} (rede {opened.network}). Só aceita conexões
                            deste computador e fecha sozinho se o servidor for desconectado. Para fechar antes, use o ×
                            ao lado do container.
                        </p>
                        <div className="confirm-modal__actions">
                            <button className="action-key ssh-primary" onClick={onClose} autoFocus>
                                Concluir
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="ssh-prompt__text">
                            Abre uma porta neste computador que leva a uma porta do container, pelo servidor{' '}
                            <strong>{host.name}</strong>. O mesmo que um <code>ssh -L</code>, sem sair do app.
                        </p>

                        {!info && !loadError && <p className="ssh-field__hint">Lendo o container…</p>}
                        {loadError && (
                            <p className="ssh-form__error" role="alert">
                                {loadError}
                            </p>
                        )}

                        {info && !info.running && (
                            <p className="ssh-form__error" role="alert">
                                O container está parado. Inicie-o antes de abrir o túnel.
                            </p>
                        )}

                        {info && info.running && (
                            <>
                                <div className="ssh-field">
                                    <span className="ssh-field__label">Rede do container</span>
                                    {nets.length > 1 ? (
                                        <select
                                            className="ssh-input ssh-input--mono"
                                            value={network}
                                            onChange={(e) => setNetwork(e.target.value)}
                                            aria-label="Rede do container"
                                        >
                                            {nets.map((n) => (
                                                <option key={n.name} value={n.name}>
                                                    {n.name} · {n.ip}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <code className="tunnel-dialog__static">
                                            {picked ? `${picked.name} · ${picked.ip}` : 'sem rede'}
                                        </code>
                                    )}
                                </div>

                                <div className="ssh-field">
                                    <span className="ssh-field__label">Porta do container</span>
                                    <div className="tunnel-dialog__ports">
                                        {(info.ports ?? []).map((p) => (
                                            <button
                                                key={p}
                                                type="button"
                                                className={`ssh-segment__opt${String(p) === remotePort ? ' ssh-segment__opt--on' : ''}`}
                                                onClick={() => {
                                                    setRemotePort(String(p));
                                                }}
                                            >
                                                {p}
                                            </button>
                                        ))}
                                        <input
                                            className="ssh-input ssh-input--mono tunnel-dialog__port"
                                            value={remotePort}
                                            onChange={(e) => setRemotePort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                                            inputMode="numeric"
                                            placeholder="outra"
                                            aria-label="Porta do container"
                                        />
                                    </div>
                                    {(info.ports ?? []).length === 0 && (
                                        <p className="ssh-field__hint">
                                            O container não declara portas (EXPOSE); digite a porta em que o serviço escuta.
                                        </p>
                                    )}
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
                                        placeholder="automática"
                                    />
                                    <span className="ssh-field__hint">
                                        Vazio = o sistema escolhe uma porta livre. Só aceita conexões de 127.0.0.1.
                                    </span>
                                </label>

                                {equivalent && (
                                    <div className="ssh-field">
                                        <span className="ssh-field__label">Equivale a</span>
                                        <code className="tunnel-dialog__cmd">{equivalent}</code>
                                    </div>
                                )}
                            </>
                        )}

                        {error && (
                            <p className="ssh-form__error" role="alert">
                                {error}
                            </p>
                        )}

                        <div className="confirm-modal__actions">
                            <button className="action-key" onClick={onClose}>
                                Cancelar
                            </button>
                            <button
                                className="action-key ssh-primary"
                                disabled={opening || !info || !info.running || nets.length === 0}
                                onClick={open}
                            >
                                {opening ? 'Abrindo' : 'Abrir túnel'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default TunnelDialog;

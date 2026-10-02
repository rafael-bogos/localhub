import { useEffect, useMemo, useState } from 'react';
import { SSHImportConfig } from '../../wailsjs/go/main/App';
import { ssh } from '../../wailsjs/go/models';
import { hostKey, type SshHost, type SshHostDraft } from '../useSshHosts';

interface SshImportDialogProps {
    existing: SshHost[];
    onImport: (drafts: SshHostDraft[]) => void;
    onCancel: () => void;
}

function toDraft(h: ssh.ConfigHost): SshHostDraft {
    return {
        name: h.name,
        address: h.address,
        port: h.port,
        user: h.user,
        method: h.keyPath ? 'key' : 'agent',
        keyPath: h.keyPath,
    };
}

/** Indexes of the entries that are new: not saved and not a repeat of an earlier entry. */
function skipFirstOccurrences(hosts: ssh.ConfigHost[], known: Set<string>): number[] {
    const seen = new Set(known);
    const keep: number[] = [];
    hosts.forEach((h, i) => {
        const key = hostKey(h);
        if (!seen.has(key)) {
            seen.add(key);
            keep.push(i);
        }
    });
    return keep;
}

/** Previews the servers found in ~/.ssh/config and imports the ones the user keeps ticked. */
function SshImportDialog({ existing, onImport, onCancel }: SshImportDialogProps) {
    const [result, setResult] = useState<ssh.ImportResult | null>(null);
    const [error, setError] = useState('');
    const [picked, setPicked] = useState<Set<number>>(new Set());

    const known = useMemo(() => new Set(existing.map(hostKey)), [existing]);
    // Why an entry can't be imported: already saved, or the same destination
    // (user, address, port) as an earlier entry of the file (two aliases of one machine).
    const skipReason = useMemo(() => {
        const seen = new Set(known);
        return (result?.hosts ?? []).map((h) => {
            const key = hostKey(h);
            if (known.has(key)) return 'já cadastrado';
            if (seen.has(key)) return 'mesmo destino';
            seen.add(key);
            return '';
        });
    }, [known, result]);

    useEffect(() => {
        let cancelled = false;
        SSHImportConfig()
            .then((r) => {
                if (cancelled) return;
                const hosts = r.hosts ?? [];
                setResult(ssh.ImportResult.createFrom({ ...r, hosts }));
                setPicked(new Set(skipFirstOccurrences(hosts, known)));
            })
            .catch((err) => !cancelled && setError(String(err).replace(/^Error:\s*/, '')));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    function toggle(i: number) {
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });
    }

    const hosts = result?.hosts ?? [];
    const selectable = hosts.map((_, i) => (skipReason[i] ? -1 : i)).filter((i) => i >= 0);
    const allPicked = selectable.length > 0 && selectable.every((i) => picked.has(i));

    return (
        <div className="confirm-overlay" onClick={onCancel}>
            <div
                className="confirm-modal ssh-form ssh-import"
                role="dialog"
                aria-modal="true"
                aria-label="Importar do SSH config"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="ssh-form__title">Importar do SSH config</h2>

                {!result && !error && <p className="ssh-field__hint">Lendo o arquivo…</p>}
                {error && (
                    <p className="ssh-form__error" role="alert">
                        {error}
                    </p>
                )}

                {result && hosts.length === 0 && (
                    <p className="ssh-field__hint">Nenhum servidor importável foi encontrado no arquivo.</p>
                )}

                {result && hosts.length > 0 && (
                    <>
                        <label className="ssh-import__all">
                            <input
                                type="checkbox"
                                checked={allPicked}
                                disabled={selectable.length === 0}
                                onChange={() => setPicked(allPicked ? new Set() : new Set(selectable))}
                            />
                            <span>
                                Selecionar todos ({selectable.length} novo{selectable.length === 1 ? '' : 's'})
                            </span>
                        </label>
                        <ul className="ssh-import__list">
                            {hosts.map((h, i) => {
                                const dup = Boolean(skipReason[i]);
                                return (
                                    <li key={`${h.name}:${i}`} className={dup ? 'ssh-import__item--dup' : undefined}>
                                        <label className="ssh-import__item">
                                            <input
                                                type="checkbox"
                                                checked={picked.has(i)}
                                                disabled={dup}
                                                onChange={() => toggle(i)}
                                            />
                                            <span className="ssh-import__name">{h.name}</span>
                                            <span className="ssh-import__addr">
                                                {h.user}@{h.address}
                                                {h.port !== 22 ? `:${h.port}` : ''}
                                            </span>
                                            <span className="ssh-import__tag">
                                                {dup ? skipReason[i] : h.keyPath ? 'chave' : 'ssh-agent'}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}

                {result && result.ignored > 0 && (
                    <p className="ssh-field__hint">
                        {result.ignored} entrada{result.ignored === 1 ? '' : 's'} ignorada
                        {result.ignored === 1 ? '' : 's'}: curingas (<code>Host *</code>), <code>Include</code>,{' '}
                        <code>Match</code> e servidores com <code>ProxyJump</code>.
                    </p>
                )}

                <div className="confirm-modal__actions">
                    <button type="button" className="action-key" onClick={onCancel}>
                        Cancelar
                    </button>
                    <button
                        type="button"
                        className="action-key ssh-primary"
                        disabled={picked.size === 0}
                        onClick={() => onImport(hosts.filter((_, i) => picked.has(i)).map(toDraft))}
                    >
                        Importar{picked.size > 0 ? ` (${picked.size})` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default SshImportDialog;

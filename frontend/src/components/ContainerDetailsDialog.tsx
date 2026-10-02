import { useEffect, useMemo, useState } from 'react';
import { docker } from '../../wailsjs/go/models';
import { KNOWN_NAME_LABELS } from '../containerName';

interface ContainerDetailsDialogProps {
    container: docker.ContainerInfo;
    /** Server the container is on, if remote. */
    hostName?: string;
    nameLabel: string;
    onNameLabelChange: (label: string) => void;
    onClose: () => void;
}

/** A container's details and labels, with the choice of which label to show as its name. */
function ContainerDetailsDialog({ container, hostName, nameLabel, onNameLabelChange, onClose }: ContainerDetailsDialogProps) {
    const [filter, setFilter] = useState('');

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const entries = useMemo(() => {
        const all = Object.entries(container.labels ?? {});
        const rank = (k: string) => {
            const i = KNOWN_NAME_LABELS.indexOf(k);
            return i === -1 ? KNOWN_NAME_LABELS.length : i;
        };
        all.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
        const q = filter.trim().toLowerCase();
        return q ? all.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) : all;
    }, [container.labels, filter]);
    const total = Object.keys(container.labels ?? {}).length;

    return (
        <div className="confirm-overlay" onClick={onClose}>
            <div
                className="confirm-modal ssh-form details-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`Detalhes de ${container.name}`}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="ssh-form__title">Container{hostName ? ` · ${hostName}` : ''}</h2>

                <dl className="ssh-fingerprint">
                    <dt>Nome no Docker</dt>
                    <dd>{container.name}</dd>
                    <dt>ID</dt>
                    <dd>{container.id.slice(0, 12)}</dd>
                    <dt>Imagem</dt>
                    <dd>{container.image}</dd>
                    {container.service && (
                        <>
                            <dt>Compose</dt>
                            <dd>
                                serviço {container.service}
                                {container.project ? ` · projeto ${container.project}` : ''}
                            </dd>
                        </>
                    )}
                </dl>

                <div className="ssh-field">
                    <span className="ssh-field__label">Etiquetas ({total})</span>
                    <p className="ssh-field__hint">
                        Plataformas como Coolify e Dokku guardam o nome legível do app numa etiqueta. Escolha a que traz o nome que
                        você quer ver: ela passa a valer para todos os containers que a tiverem.
                    </p>
                </div>

                {nameLabel && (
                    <p className="details-dialog__current">
                        <span>
                            Nome de exibição vem de <code>{nameLabel}</code>
                        </span>
                        <button className="action-key" onClick={() => onNameLabelChange('')}>
                            Usar o nome do Docker
                        </button>
                    </p>
                )}

                {total === 0 ? (
                    <p className="ssh-field__hint">Este container não tem etiquetas.</p>
                ) : (
                    <>
                        {total > 6 && (
                            <input
                                className="ssh-input ssh-input--mono"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                placeholder="Filtrar etiquetas"
                                aria-label="Filtrar etiquetas"
                            />
                        )}
                        <ul className="details-dialog__labels">
                            {entries.map(([key, value]) => {
                                const active = key === nameLabel;
                                return (
                                    <li key={key} className={active ? 'details-dialog__label--on' : undefined}>
                                        <span className="details-dialog__key">{key}</span>
                                        <span className="details-dialog__value">{value || '(vazio)'}</span>
                                        <button
                                            className="action-key"
                                            disabled={active || !value.trim()}
                                            onClick={() => onNameLabelChange(key)}
                                            title={value.trim() ? `Mostrar "${value}" como nome` : 'Etiqueta vazia'}
                                        >
                                            {active ? 'Em uso' : 'Usar como nome'}
                                        </button>
                                    </li>
                                );
                            })}
                            {entries.length === 0 && <li className="ssh-field__hint">Nenhuma etiqueta corresponde ao filtro.</li>}
                        </ul>
                    </>
                )}

                <div className="confirm-modal__actions">
                    <button className="action-key ssh-primary" onClick={onClose} autoFocus>
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ContainerDetailsDialog;

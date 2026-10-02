import type { ReactNode } from 'react';
import { ChevronIcon } from './icons';

interface HostGroupProps {
    /** DOM id, so the jump strip can scroll to this section. */
    id?: string;
    /** "Esta máquina" or the server's name. */
    title: string;
    remote: boolean;
    /** `usuário@endereço` of a remote server. */
    subtitle?: string;
    /** Header shown only when there is more than one machine to tell apart. */
    showHeader: boolean;
    collapsed: boolean;
    onToggle: () => void;
    /** Items of this machine in the current tab. */
    count?: number | null;
    /** Remote only: the link dropped; the body shows `message` and a way back. */
    disconnected?: boolean;
    message?: string;
    reconnecting?: boolean;
    onReconnect?: () => void;
    children?: ReactNode;
}

/**
 * One machine's section in the Processos, Containers and Imagens tabs. With
 * only this machine in play the header is hidden and the tab looks exactly as
 * it always did; the body stays mounted so nothing reloads when it appears.
 */
function HostGroup({
    id,
    title,
    remote,
    subtitle,
    showHeader,
    collapsed,
    onToggle,
    count,
    disconnected,
    message,
    reconnecting,
    onReconnect,
    children,
}: HostGroupProps) {
    const hidden = showHeader && collapsed;
    return (
        <section
            id={id}
            className={[
                'host-group',
                remote ? 'host-group--remote' : '',
                showHeader ? '' : 'host-group--bare',
                disconnected ? 'host-group--down' : '',
            ]
                .filter(Boolean)
                .join(' ')}
            aria-label={remote ? `Servidor ${title}` : 'Esta máquina'}
        >
            {showHeader && (
                <header className="host-group__header">
                    <button
                        className="host-group__toggle"
                        aria-expanded={!collapsed}
                        onClick={onToggle}
                        title={collapsed ? 'Expandir' : 'Recolher'}
                    >
                        <ChevronIcon size={12} className={collapsed ? undefined : 'host-group__chevron--open'} />
                        <span className="host-group__title">{title}</span>
                    </button>
                    <span className={`host-group__badge${remote ? ' host-group__badge--remote' : ''}`}>
                        {remote ? 'Remoto' : 'Local'}
                    </span>
                    {subtitle && <span className="host-group__sub">{subtitle}</span>}
                    <span className="host-group__spacer" />
                    {disconnected && <span className="status-chip">Desconectado</span>}
                    {disconnected && onReconnect && (
                        <button className="action-key" disabled={reconnecting} onClick={onReconnect}>
                            {reconnecting ? 'Conectando' : 'Reconectar'}
                        </button>
                    )}
                    {!disconnected && typeof count === 'number' && (
                        <span className="host-group__count" title="Itens desta máquina">
                            {count}
                        </span>
                    )}
                </header>
            )}
            <div className="host-group__body" hidden={hidden}>
                {disconnected ? (
                    <p className="host-group__note">
                        {reconnecting
                            ? 'Reconectando…'
                            : message
                              ? `A conexão foi encerrada: ${message}`
                              : 'A conexão foi encerrada. Os dados anteriores não são mais exibidos.'}
                    </p>
                ) : (
                    children
                )}
            </div>
        </section>
    );
}

export default HostGroup;

/** A quiet line inside a group: loading, "no Docker here", limited visibility. */
export function GroupNote({ children, tone }: { children: ReactNode; tone?: 'warn' }) {
    return <p className={`host-group__note${tone === 'warn' ? ' host-group__note--warn' : ''}`}>{children}</p>;
}

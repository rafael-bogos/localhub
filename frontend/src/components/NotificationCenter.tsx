import { useEffect, useRef, useState } from 'react';
import type { StopNotice, StopNotices } from '../useStopNotices';
import { AlertIcon, BellIcon, CloseIcon, StopIcon } from './icons';

const TOAST_MS = 8000;

/** "agora", "há 5 min", "há 2 h": notices are about the last hours, not dates. */
function ago(at: number, now: number): string {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 45) return 'agora';
    if (s < 3600) return `há ${Math.max(1, Math.round(s / 60))} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`;
    return `há ${Math.round(s / 86400)} d`;
}

/** Re-renders every `ms` so relative times stay true while the panel is open. */
function useNow(active: boolean, ms = 20000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const t = window.setInterval(() => setNow(Date.now()), ms);
        return () => window.clearInterval(t);
    }, [active, ms]);
    return now;
}

function NoticeIcon({ kind }: { kind: StopNotice['kind'] }) {
    return (
        <span className={`notice-icon notice-icon--${kind}`}>
            {kind === 'failed' ? <AlertIcon size={14} /> : <StopIcon size={13} />}
        </span>
    );
}

interface NoticeTextProps {
    notice: StopNotice;
    hostLabel: string;
}

function NoticeText({ notice, hostLabel }: NoticeTextProps) {
    return (
        <span className="notice-text">
            <span className="notice-text__title">{notice.title}</span>
            <span className="notice-text__detail">{notice.detail}</span>
            <span className="notice-text__where">
                {hostLabel}
                {notice.image ? ` · imagem ${notice.image}` : ''}
            </span>
        </span>
    );
}

interface NotificationCenterProps {
    api: StopNotices;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Name the user gave a server; falls back to what the backend sent. */
    hostLabel: (notice: StopNotice) => string;
    /** Take the user to the container's tab (and its server's group). */
    onGoTo: (notice: StopNotice) => void;
}

/** The bell in the header, its history panel, and the toasts for fresh notices. */
function NotificationCenter({ api, open, onOpenChange, hostLabel, onGoTo }: NotificationCenterProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const now = useNow(open);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onOpenChange(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, onOpenChange]);

    function toggle() {
        if (!open) api.markAllRead();
        onOpenChange(!open);
    }

    function goTo(n: StopNotice) {
        onOpenChange(false);
        api.dismissToast(n.id);
        onGoTo(n);
    }

    return (
        <>
            <div className="notif" ref={rootRef}>
                <button
                    type="button"
                    className={`notif__bell${open ? ' notif__bell--open' : ''}`}
                    onClick={toggle}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-label={api.unread ? `Notificações, ${api.unread} não lidas` : 'Notificações'}
                    title="Notificações"
                >
                    <BellIcon />
                    {api.unread > 0 && <span className="notif__badge">{api.unread > 9 ? '9+' : api.unread}</span>}
                </button>

                {open && (
                    <section className="notif__panel" role="dialog" aria-label="Notificações">
                        <header className="notif__head">
                            <h2 className="notif__title">Notificações</h2>
                            {api.notices.length > 0 && (
                                <button type="button" className="notif__link" onClick={api.clear}>
                                    Limpar tudo
                                </button>
                            )}
                        </header>
                        {api.notices.length === 0 ? (
                            <p className="notif__empty">
                                Nada por aqui. Você é avisado quando um container parar, aqui e nos servidores conectados.
                            </p>
                        ) : (
                            <ul className="notif__list">
                                {api.notices.map((n) => (
                                    <li key={n.id} className="notif__item">
                                        <button type="button" className="notif__go" onClick={() => goTo(n)}>
                                            <NoticeIcon kind={n.kind} />
                                            <NoticeText notice={n} hostLabel={hostLabel(n)} />
                                            <time className="notif__time" dateTime={new Date(n.at).toISOString()}>
                                                {ago(n.at, now)}
                                            </time>
                                        </button>
                                        <button
                                            type="button"
                                            className="notif__x"
                                            onClick={() => api.remove(n.id)}
                                            aria-label={`Descartar: ${n.title}`}
                                            title="Descartar"
                                        >
                                            <CloseIcon size={11} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}
            </div>

            <div className="toasts" role="region" aria-label="Avisos recentes">
                {api.toasts.map((n) => (
                    <Toast
                        key={n.id}
                        notice={n}
                        hostLabel={hostLabel(n)}
                        onClose={() => api.dismissToast(n.id)}
                        onGoTo={() => goTo(n)}
                    />
                ))}
            </div>
        </>
    );
}

interface ToastProps {
    notice: StopNotice;
    hostLabel: string;
    onClose: () => void;
    onGoTo: () => void;
}

/** One toast: leaves on its own after a while, unless the pointer or focus is on it. */
function Toast({ notice, hostLabel, onClose, onGoTo }: ToastProps) {
    const [held, setHeld] = useState(false);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (held) return;
        const t = window.setTimeout(() => onCloseRef.current(), TOAST_MS);
        return () => window.clearTimeout(t);
    }, [held]);

    return (
        <div
            className={`toast toast--${notice.kind}`}
            role={notice.kind === 'failed' ? 'alert' : 'status'}
            onMouseEnter={() => setHeld(true)}
            onMouseLeave={() => setHeld(false)}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
        >
            <button type="button" className="toast__go" onClick={onGoTo} title="Ver na aba Containers">
                <NoticeIcon kind={notice.kind} />
                <NoticeText notice={notice} hostLabel={hostLabel} />
            </button>
            <button type="button" className="notif__x" onClick={onClose} aria-label="Fechar aviso" title="Fechar">
                <CloseIcon size={11} />
            </button>
        </div>
    );
}

export default NotificationCenter;

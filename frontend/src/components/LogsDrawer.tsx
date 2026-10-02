import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import { MAX_LINES, useContainerLogs, type LogEntry } from '../useContainerLogs';
import { CLEARED_FILTERS, MIN_WIDTH, isFiltering, type LogsPrefs, type PrefsPatch } from '../useLogsPrefs';
import type { Level } from '../logLevel';
import LogsToolbar from './LogsToolbar';
import { AlertIcon, CloseIcon, ExpandIcon, ShrinkIcon } from './icons';

const NEAR_BOTTOM_PX = 48;
const PERIOD_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const;
const PERIOD_TICK_MS = 15_000;

const LEVEL_TAG: Record<Level, string> = {
    erro: 'ERR',
    aviso: 'WRN',
    info: 'INF',
    debug: 'DBG',
    outros: '',
};

export interface LogsTarget {
    id: string;
    name: string;
    /** Set when the container lives on an SSH server (id and display name). */
    hostId?: string;
    hostName?: string;
}

interface LogsDrawerProps {
    target: LogsTarget;
    prefs: LogsPrefs;
    onPrefsChange: (patch: PrefsPatch) => void;
    onClose: () => void;
}

interface Matcher {
    /** Non-global, safe to call repeatedly. */
    test: RegExp | null;
    /** Global, for highlighting. */
    highlight: RegExp | null;
    error: boolean;
}

function buildMatcher(query: string, regex: boolean): Matcher {
    if (!query) return { test: null, highlight: null, error: false };
    const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return { test: new RegExp(source, 'i'), highlight: new RegExp(source, 'gi'), error: false };
    } catch {
        return { test: null, highlight: null, error: true };
    }
}

// Log text is untrusted input: it is only ever rendered as text nodes, never as HTML.
function renderHighlighted(text: string, re: RegExp): ReactNode {
    const parts: ReactNode[] = [];
    let last = 0;
    let key = 0;
    for (const m of text.matchAll(re)) {
        if (m[0].length === 0) continue;
        const at = m.index ?? 0;
        if (at > last) parts.push(text.slice(last, at));
        parts.push(<mark key={key++}>{m[0]}</mark>);
        last = at + m[0].length;
    }
    if (parts.length === 0) return text;
    if (last < text.length) parts.push(text.slice(last));
    return parts;
}

interface LogRowProps {
    entry: LogEntry;
    highlight: RegExp | null;
    current: boolean;
}

const LogRow = memo(function LogRow({ entry, highlight, current }: LogRowProps) {
    return (
        <div
            className={`log-line log-line--${entry.level}${entry.stream === 'stderr' ? ' log-line--stderr' : ''}${
                current ? ' log-line--current' : ''
            }`}
            data-line-id={entry.id}
        >
            <span className="log-line__time">{entry.clock}</span>
            <span className="log-line__stream" title={entry.stream}>
                {entry.stream === 'stderr' ? '!' : '›'}
            </span>
            <span className="log-line__level">{LEVEL_TAG[entry.level]}</span>
            <span className="log-line__text">{highlight ? renderHighlighted(entry.text, highlight) : entry.text}</span>
        </div>
    );
});

async function copyText(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        return;
    } catch {
        // Fall back for webviews without the async clipboard API.
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
}

function LogsDrawer({ target, prefs, onPrefsChange, onClose }: LogsDrawerProps) {
    const logs = useContainerLogs(target.id, target.hostId);
    const listRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const anchor = useRef<{ height: number; top: number } | null>(null);
    const prevFirstId = useRef<number | undefined>(undefined);

    const [stick, setStick] = useState(true);
    const [seenId, setSeenId] = useState(0);
    const [matchIndex, setMatchIndex] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const [copied, setCopied] = useState(false);

    const matcher = useMemo(() => buildMatcher(prefs.query, prefs.regex), [prefs.query, prefs.regex]);

    // The period window is relative to "now": re-evaluate it as time passes.
    useEffect(() => {
        if (prefs.period === 'all') return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), PERIOD_TICK_MS);
        return () => clearInterval(id);
    }, [prefs.period]);

    const visible = useMemo(() => {
        const since = prefs.period === 'all' ? null : now - PERIOD_MS[prefs.period];
        const filterText = prefs.mode === 'filtrar' ? matcher.test : null;
        return logs.lines.filter((l) => {
            if (!prefs.sources[l.stream] || !prefs.levels[l.level]) return false;
            // Lines with no timestamp can't be placed in time: always kept.
            if (since !== null && l.tsMs !== null && l.tsMs < since) return false;
            if (filterText && !filterText.test(l.text)) return false;
            return true;
        });
    }, [logs.lines, prefs.sources, prefs.levels, prefs.period, prefs.mode, matcher, now]);

    const matchIds = useMemo(() => {
        if (prefs.mode !== 'destacar' || !matcher.test) return [];
        const re = matcher.test;
        return visible.filter((l) => re.test(l.text)).map((l) => l.id);
    }, [visible, prefs.mode, matcher]);

    const safeMatchIndex = matchIds.length === 0 ? 0 : Math.min(matchIndex, matchIds.length - 1);
    const currentId = matchIds[safeMatchIndex];

    useEffect(() => {
        setMatchIndex(0);
    }, [prefs.query, prefs.regex, prefs.mode]);

    const scrollToBottom = useCallback(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    // Keep the reading position when older lines are inserted at the top;
    // otherwise follow the newest line while the view is at the bottom.
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const firstId = logs.lines[0]?.id;
        const prepended = anchor.current !== null && firstId !== prevFirstId.current;
        prevFirstId.current = firstId;

        if (prepended && anchor.current) {
            el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
            anchor.current = null;
            return;
        }
        if (prefs.follow && stick) {
            el.scrollTop = el.scrollHeight;
        }
    }, [visible, logs.lines, prefs.follow, stick]);

    useEffect(() => {
        if (stick && visible.length > 0) setSeenId(visible[visible.length - 1].id);
    }, [stick, visible]);

    const unseen = useMemo(() => {
        if (stick) return 0;
        let n = 0;
        for (let i = visible.length - 1; i >= 0 && visible[i].id > seenId; i--) n++;
        return n;
    }, [stick, visible, seenId]);

    function handleScroll() {
        const el = listRef.current;
        if (!el) return;
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
        setStick((prev) => (prev === near ? prev : near));
    }

    function jumpToBottom() {
        setStick(true);
        scrollToBottom();
    }

    const goToMatch = useCallback((index: number, ids: number[]) => {
        const id = ids[index];
        if (id === undefined) return;
        setMatchIndex(index);
        requestAnimationFrame(() => {
            listRef.current
                ?.querySelector(`[data-line-id="${id}"]`)
                ?.scrollIntoView({ block: 'center' });
        });
    }, []);

    function nextMatch() {
        if (matchIds.length === 0) return;
        goToMatch((safeMatchIndex + 1) % matchIds.length, matchIds);
    }

    function prevMatch() {
        if (matchIds.length === 0) return;
        goToMatch((safeMatchIndex - 1 + matchIds.length) % matchIds.length, matchIds);
    }

    async function handleLoadOlder() {
        const el = listRef.current;
        if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
        await logs.loadOlder();
        // If nothing was inserted the anchor was never consumed: drop it so it
        // can't skew an unrelated render.
        setTimeout(() => {
            anchor.current = null;
        }, 1000);
    }

    async function handleCopy() {
        await copyText(visible.map((l) => (l.ts ? `${l.ts} ${l.text}` : l.text)).join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    // Esc closes, Ctrl/Cmd+F jumps to the search box.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Never leave the page stuck in "resizing" if the drawer closes mid-drag.
    useEffect(() => () => document.body.classList.remove('is-resizing'), []);

    // Drag the left edge to resize the side panel.
    function startResize(e: ReactPointerEvent<HTMLDivElement>) {
        if (prefs.expanded) return;
        // Without this the drag also starts a text selection under the pointer.
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        document.body.classList.add('is-resizing');
        const handle = e.currentTarget;
        const drawer = handle.parentElement;
        const workspace = drawer?.parentElement;
        if (!drawer || !workspace) return;
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startWidth = drawer.getBoundingClientRect().width;
        const max = Math.max(MIN_WIDTH, workspace.getBoundingClientRect().width * 0.75);

        function onMove(ev: PointerEvent) {
            const width = Math.round(Math.min(max, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX))));
            onPrefsChange({ width });
        }
        function onEnd(ev: PointerEvent) {
            if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onEnd);
            handle.removeEventListener('pointercancel', onEnd);
            document.body.classList.remove('is-resizing');
        }
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
    }

    const filtering = isFiltering(prefs);
    const status = statusOf(logs);

    return (
        <aside
            className={`logs-drawer${prefs.expanded ? ' logs-drawer--expanded' : ''}`}
            style={prefs.expanded ? undefined : { flexBasis: prefs.width }}
            aria-label={`Logs de ${target.name}${target.hostName ? ` em ${target.hostName}` : ''}`}
        >
            {!prefs.expanded && (
                <div
                    className="logs-drawer__resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Redimensionar o painel de logs"
                    onPointerDown={startResize}
                    onMouseDown={(e) => e.preventDefault()}
                />
            )}

            <header className="logs-drawer__header">
                <div className="logs-drawer__title">
                    {target.hostId && (
                        <span className="host-group__badge host-group__badge--remote" title={`Servidor ${target.hostName ?? ''}`}>
                            {target.hostName || 'Remoto'}
                        </span>
                    )}
                    <span className="logs-drawer__name" title={target.name}>
                        {target.name}
                    </span>
                    <span className={`status-chip${status.live ? ' status-chip--listen' : ''}`}>{status.text}</span>
                </div>
                <div className="logs-drawer__buttons">
                    <button
                        className="logs-icon-btn"
                        onClick={() => onPrefsChange((p) => ({ expanded: !p.expanded }))}
                        title={prefs.expanded ? 'Voltar ao painel lateral' : 'Expandir'}
                        aria-label={prefs.expanded ? 'Voltar ao painel lateral' : 'Expandir o painel'}
                    >
                        {prefs.expanded ? <ShrinkIcon /> : <ExpandIcon />}
                    </button>
                    <button className="logs-icon-btn" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar os logs">
                        <CloseIcon size={13} />
                    </button>
                </div>
            </header>

            <LogsToolbar
                prefs={prefs}
                onChange={onPrefsChange}
                searchRef={searchRef}
                queryError={matcher.error}
                visibleCount={visible.length}
                totalCount={logs.lines.length}
                matchCount={matchIds.length}
                matchIndex={safeMatchIndex}
                onPrevMatch={prevMatch}
                onNextMatch={nextMatch}
                filtering={filtering}
                onClearFilters={() => onPrefsChange(CLEARED_FILTERS)}
                frozen={logs.frozen}
                pendingCount={logs.pendingCount}
                onToggleFrozen={() => logs.setFrozen(!logs.frozen)}
                onClear={logs.clear}
                onCopy={handleCopy}
                copied={copied}
            />

            {logs.error && logs.state !== 'error' && (
                <p className="alert logs-drawer__alert" role="alert">
                    <AlertIcon size={15} />
                    {logs.error}
                </p>
            )}

            <div className="logs-listwrap">
                <div
                    className="logs-list"
                    ref={listRef}
                    onScroll={handleScroll}
                    role="log"
                    aria-live="off"
                    aria-label="Linhas de log"
                    tabIndex={0}
                >
                    {logs.lines.length > 0 && (
                        <div className="logs-history">
                            {logs.dropped && (
                                <span className="logs-history__note">
                                    Logs antigos descartados (limite de {MAX_LINES} linhas).
                                </span>
                            )}
                            {logs.historyEnded ? (
                                <span className="logs-history__note">Início dos logs</span>
                            ) : logs.lines.length >= MAX_LINES ? (
                                <button className="logs-chip" disabled title="Limpe a tela ou use os filtros para continuar">
                                    Limite do buffer atingido
                                </button>
                            ) : (
                                logs.canLoadOlder && (
                                    <button
                                        className="logs-chip"
                                        onClick={handleLoadOlder}
                                        disabled={logs.loadingOlder}
                                    >
                                        {logs.loadingOlder ? 'Carregando…' : 'Carregar mais antigas'}
                                    </button>
                                )
                            )}
                        </div>
                    )}

                    {visible.map((entry) => (
                        <LogRow
                            key={entry.id}
                            entry={entry}
                            highlight={matcher.highlight}
                            current={entry.id === currentId}
                        />
                    ))}

                    {visible.length === 0 && (
                        <p className="logs-empty">{emptyMessage(logs.state, logs.lines.length, filtering)}</p>
                    )}
                </div>

                {unseen > 0 && (
                    <button className="logs-unseen" onClick={jumpToBottom}>
                        {unseen} {unseen === 1 ? 'nova linha' : 'novas linhas'} ↓
                    </button>
                )}
            </div>
        </aside>
    );
}

function statusOf(logs: ReturnType<typeof useContainerLogs>): { text: string; live: boolean } {
    switch (logs.state) {
        case 'loading':
            return { text: 'Conectando…', live: false };
        case 'error':
            return { text: logs.error || 'Erro ao abrir os logs', live: false };
        case 'ended':
            return { text: logs.end?.message || 'Encerrado', live: false };
        default:
            return logs.frozen ? { text: 'Pausado', live: false } : { text: 'Ao vivo', live: true };
    }
}

function emptyMessage(state: string, total: number, filtering: boolean): string {
    if (state === 'loading') return 'Carregando logs…';
    if (state === 'error') return 'Não foi possível abrir os logs deste container.';
    if (total > 0 && filtering) return 'Nenhuma linha corresponde à busca e aos filtros.';
    return 'Nenhuma linha de log ainda.';
}

export default LogsDrawer;

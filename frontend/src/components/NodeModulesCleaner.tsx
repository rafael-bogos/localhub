import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CancelNodeModulesScan,
    NodeModulesSize,
    PickDirectory,
    RemoveNodeModules,
    ScanNodeModules,
} from '../../wailsjs/go/main/App';
import { nodemodules } from '../../wailsjs/go/models';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { formatBytes } from '../format';
import { AlertIcon, BroomIcon, FolderIcon, SearchIcon } from './icons';
import { useConfirm } from './ConfirmDialog';

const STORAGE_KEY = 'localhub.nodemodules.v1';
const SIZE_WORKERS = 3;

type Status = 'idle' | 'removing' | 'removed' | 'error';

interface Item {
    entry: nodemodules.Entry;
    /** Bytes; null while still being measured, -1 if it couldn't be measured. */
    size: number | null;
    selected: boolean;
    status: Status;
    error?: string;
}

interface Summary {
    removed: number;
    failed: number;
    freed: number;
}

function loadRoot(): string {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const value = raw ? JSON.parse(raw)?.root : '';
        return typeof value === 'string' ? value : '';
    } catch {
        return '';
    }
}

function saveRoot(root: string) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ root }));
    } catch {
        // Storage unavailable: the folder just isn't remembered.
    }
}

interface NodeModulesCleanerProps {
    onCountChange: (count: number) => void;
}

function NodeModulesCleaner({ onCountChange }: NodeModulesCleanerProps) {
    const confirm = useConfirm();
    const [root, setRoot] = useState(loadRoot);
    const [scannedRoot, setScannedRoot] = useState('');
    const [items, setItems] = useState<Item[]>([]);
    const [scanning, setScanning] = useState(false);
    const [scanned, setScanned] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [error, setError] = useState('');
    const [summary, setSummary] = useState<Summary | null>(null);

    // Bumped whenever a scan starts, is cancelled or the panel unmounts, so a
    // late result or size from an older scan is ignored.
    const scanToken = useRef(0);
    const itemsRef = useRef<Item[]>([]);
    itemsRef.current = items;

    const selectable = useMemo(() => items.filter((i) => i.status !== 'removed'), [items]);
    const selected = useMemo(() => selectable.filter((i) => i.selected), [selectable]);
    const allSelected = selectable.length > 0 && selected.length === selectable.length;
    const selectedBytes = selected.reduce((sum, i) => sum + (i.size && i.size > 0 ? i.size : 0), 0);
    const sizePending = selected.some((i) => i.size === null);
    const busy = scanning || removing;

    useEffect(() => {
        onCountChange(selected.length);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected.length]);

    useEffect(
        () => () => {
            scanToken.current++;
        },
        []
    );

    const patch = useCallback((path: string, change: Partial<Item>) => {
        setItems((prev) => prev.map((i) => (i.entry.path === path ? { ...i, ...change } : i)));
    }, []);

    // Sizes are measured in the background, a few at a time, so the list shows
    // up at once instead of waiting for every folder to be walked.
    function measureSizes(entries: nodemodules.Entry[], token: number) {
        let next = 0;
        async function worker() {
            while (token === scanToken.current) {
                const entry = entries[next++];
                if (!entry) return;
                let size = -1;
                try {
                    size = await NodeModulesSize(entry.path);
                } catch {
                    // Left unknown ("—"); it can still be removed.
                }
                if (token !== scanToken.current) return;
                patch(entry.path, { size });
            }
        }
        for (let w = 0; w < SIZE_WORKERS; w++) worker();
    }

    async function handleScan() {
        const value = root.trim();
        if (!value) {
            setError('Informe o diretório raiz onde procurar.');
            return;
        }
        const token = ++scanToken.current;
        setError('');
        setSummary(null);
        setItems([]);
        setScanned(false);
        setScanning(true);
        try {
            const result = await ScanNodeModules(value);
            if (token !== scanToken.current) return;
            const entries = result.entries ?? [];
            setItems(entries.map((entry) => ({ entry, size: null, selected: true, status: 'idle' })));
            setScannedRoot(result.root);
            setScanned(true);
            saveRoot(value);
            measureSizes(entries, token);
        } catch (err) {
            if (token === scanToken.current) setError(String(err));
        } finally {
            if (token === scanToken.current) setScanning(false);
        }
    }

    function handleCancelScan() {
        scanToken.current++;
        CancelNodeModulesScan();
        setScanning(false);
    }

    async function handlePick() {
        try {
            const dir = await PickDirectory();
            if (dir) {
                setRoot(dir);
                setError('');
            }
        } catch (err) {
            setError(String(err));
        }
    }

    function toggle(path: string) {
        setSummary(null);
        patch(path, { selected: !itemsRef.current.find((i) => i.entry.path === path)?.selected });
    }

    function toggleAll() {
        setSummary(null);
        const next = !allSelected;
        setItems((prev) => prev.map((i) => (i.status === 'removed' ? i : { ...i, selected: next })));
    }

    async function handleRemove() {
        const targets = itemsRef.current.filter((i) => i.selected && i.status !== 'removed');
        if (targets.length === 0) return;

        const total = targets.reduce((sum, i) => sum + (i.size && i.size > 0 ? i.size : 0), 0);
        const pending = targets.some((i) => i.size === null);
        const confirmed = await confirm(
            `Remover o node_modules de ${targets.length} ${targets.length === 1 ? 'projeto' : 'projetos'} ` +
                `(${pending ? 'pelo menos ' : ''}${formatBytes(total)})? Essa ação não pode ser desfeita. ` +
                `Para reinstalar, rode "npm install" no projeto.`
        );
        if (!confirmed) return;

        const paths = targets.map((i) => i.entry.path);
        const pathSet = new Set(paths);
        setError('');
        setSummary(null);
        setRemoving(true);
        setItems((prev) =>
            prev.map((i) => (pathSet.has(i.entry.path) ? { ...i, status: 'removing', error: undefined } : i))
        );

        const apply = (r: nodemodules.RemoveResult) =>
            patch(
                r.path,
                r.ok ? { status: 'removed', selected: false, error: undefined } : { status: 'error', error: r.error }
            );
        const off = EventsOn('nodemodules:removed', (r: nodemodules.RemoveResult) => apply(r));

        try {
            const results = await RemoveNodeModules(paths);
            // The returned list is authoritative; the events only made it live.
            results.forEach(apply);
            const okPaths = new Set(results.filter((r) => r.ok).map((r) => r.path));
            const freed = targets
                .filter((i) => okPaths.has(i.entry.path))
                .reduce((sum, i) => sum + (i.size && i.size > 0 ? i.size : 0), 0);
            setSummary({ removed: okPaths.size, failed: results.length - okPaths.size, freed });
        } catch (err) {
            setError(String(err));
            setItems((prev) => prev.map((i) => (i.status === 'removing' ? { ...i, status: 'idle' } : i)));
        } finally {
            off();
            setRemoving(false);
        }
    }

    return (
        <>
            <div className="nm-root">
                <div className="port-search nm-root__field">
                    <FolderIcon size={14} className="port-search__icon" />
                    <input
                        type="text"
                        className="port-search__input"
                        placeholder="Diretório raiz, ex.: /home/você/projetos"
                        value={root}
                        spellCheck={false}
                        disabled={busy}
                        aria-label="Diretório raiz onde procurar node_modules"
                        onChange={(e) => setRoot(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !busy) handleScan();
                        }}
                    />
                </div>
                <button className="action-key" onClick={handlePick} disabled={busy}>
                    Escolher pasta…
                </button>
                <button className="action-key" onClick={handleScan} disabled={busy || !root.trim()}>
                    <SearchIcon size={14} />
                    {scanning ? 'Procurando…' : 'Procurar'}
                </button>
                {scanning && (
                    <button className="action-key" onClick={handleCancelScan}>
                        Cancelar
                    </button>
                )}
            </div>

            {error && (
                <p className="alert" role="alert">
                    <AlertIcon size={15} />
                    {error}
                </p>
            )}

            {!scanned && !scanning && items.length === 0 && !error && (
                <p className="nm-hint">
                    Informe uma pasta e clique em <strong>Procurar</strong>. A busca lista só os projetos (pastas com{' '}
                    <code>package.json</code>) que têm <code>node_modules</code>; todos vêm marcados, e você desmarca o
                    que quiser manter.
                </p>
            )}

            {scanning && <p className="nm-hint">Procurando node_modules em {root.trim()}…</p>}

            {scanned && items.length === 0 && (
                <p className="nm-hint">Nenhum node_modules de projeto encontrado em {scannedRoot}.</p>
            )}

            {items.length > 0 && (
                <>
                    <label className="cleanup-row cleanup-row--all">
                        <input
                            type="checkbox"
                            className="cleanup-checkbox"
                            checked={allSelected}
                            disabled={removing || selectable.length === 0}
                            onChange={toggleAll}
                        />
                        <span className="cleanup-row__text">
                            <span className="cleanup-row__label">Selecionar tudo</span>
                            <span className="cleanup-row__description">
                                {selected.length} de {selectable.length}{' '}
                                {selectable.length === 1 ? 'projeto selecionado' : 'projetos selecionados'}
                                {selected.length > 0 &&
                                    ` · ${sizePending ? 'pelo menos ' : ''}${formatBytes(selectedBytes)} a liberar`}
                            </span>
                        </span>
                    </label>

                    <div className="cleanup-list nm-list">
                        {items.map((item) => {
                            const { entry } = item;
                            const removed = item.status === 'removed';
                            return (
                                <label
                                    key={entry.path}
                                    className={`cleanup-row nm-row${removed ? ' nm-row--removed' : ''}`}
                                    title={entry.path}
                                >
                                    <input
                                        type="checkbox"
                                        className="cleanup-checkbox"
                                        checked={item.selected}
                                        disabled={removed || removing}
                                        onChange={() => toggle(entry.path)}
                                    />
                                    <span className="cleanup-row__text nm-row__text">
                                        <span className="cleanup-row__label">{entry.name}</span>
                                        <span className="cleanup-row__description nm-row__path">
                                            {entry.dir}
                                        </span>
                                        {item.status === 'error' && (
                                            <span className="nm-row__error">{item.error || 'Falha ao remover.'}</span>
                                        )}
                                    </span>
                                    <span className="nm-row__aside">
                                        {item.status === 'removing' ? (
                                            <span className="status-chip">Removendo…</span>
                                        ) : removed ? (
                                            <span className="status-chip">Removido</span>
                                        ) : (
                                            <span className="nm-row__size">
                                                {item.size === null ? 'calculando…' : item.size < 0 ? '—' : formatBytes(item.size)}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            );
                        })}
                    </div>

                    <div className="row-actions" style={{ justifyContent: 'flex-start', marginTop: '14px' }}>
                        <button className="action-key" disabled={busy || selected.length === 0} onClick={handleRemove}>
                            <BroomIcon size={14} />
                            {removing ? 'Removendo' : allSelected ? 'Limpar tudo' : 'Limpar selecionados'}
                        </button>
                        {summary && (
                            <span className="prune-result">
                                {summary.removed} {summary.removed === 1 ? 'pasta removida' : 'pastas removidas'}
                                {summary.freed > 0 && ` — ${formatBytes(summary.freed)} liberados`}
                                {summary.failed > 0 && ` · ${summary.failed} com erro`}.
                            </span>
                        )}
                    </div>
                </>
            )}
        </>
    );
}

export default NodeModulesCleaner;

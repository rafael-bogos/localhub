import { useSmoothScroll } from '../useSmoothScroll';
import { Select } from './Select';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DBBrowse, DBUpdate } from '../../wailsjs/go/main/App';
import { orm } from '../../wailsjs/go/models';
import { useConfirm } from './ConfirmDialog';
import { SearchIcon } from './icons';

const PAGE_SIZE = 50;
const MIN_WIDTH = 60;
const MAX_WIDTH = 900;
// The backend cuts a cell at 2000 characters and appends "…": such a value is
// not the real one, so it must not be edited and saved back.
const TRUNCATED_LEN = 2001;

const errText = (err: unknown) => String(err).replace(/^Error:\s*/, '');

const NUMERIC = /^(smallint|integer|int|int\d|bigint|tinyint|mediumint|serial|bigserial|numeric|decimal|real|double|float)/i;
const BINARY = /(bytea|blob|binary|varbinary)/i;

/** A column's width in pixels. */
type Widths = Record<string, number>;

interface RowEdit {
    /** Primary key of the row: column -> value. */
    key: Record<string, string>;
    /** Changed columns; null is SQL NULL. */
    set: Record<string, string | null>;
}

// Edits and column widths outlive the component (switching to "Estrutura" and
// back, or to another table and back, keeps them) but not the app session.
const pendingStore = new Map<string, Map<string, RowEdit>>();
const widthStore = new Map<string, Widths>();

interface DataGridProps {
    connectionId: string;
    table: orm.Table;
    /** The connection forbids writes: cells stay read-only. */
    readOnly: boolean;
}

/**
 * Real rows of one table: paged, sortable, searchable, with resizable columns.
 * Click a cell to edit it; edits are collected and saved together.
 */
function DataGrid({ connectionId, table, readOnly }: DataGridProps) {
    const confirm = useConfirm();
    const tableKey = `${connectionId}|${table.schema}|${table.name}`;

    // The page remembers which table it belongs to: right after a table switch
    // the old rows must not be drawn with the new table's columns.
    const [loaded, setLoaded] = useState<{ key: string; page: orm.Page } | null>(null);
    const page = loaded?.key === tableKey ? loaded.page : null;
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [offset, setOffset] = useState(0);
    const [orderBy, setOrderBy] = useState('');
    const [desc, setDesc] = useState(false);
    const [input, setInput] = useState('');
    const [search, setSearch] = useState('');
    // Where and how to search. Default: the indexed columns, "começa com"; only
    // "contém" (on a chosen column) has to read every row.
    const [searchColumn, setSearchColumn] = useState('');
    const [searchMode, setSearchMode] = useState<'prefix' | 'exact' | 'contains'>('prefix');
    const [widths, setWidths] = useState<Widths>(() => widthStore.get(tableKey) ?? {});
    const [pending, setPending] = useState<Map<string, RowEdit>>(() => pendingStore.get(tableKey) ?? new Map());
    const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
    const [saving, setSaving] = useState(false);
    // Only the newest request may update the grid (fast typing, fast paging).
    const seq = useRef(0);
    const scroller = useRef<HTMLDivElement>(null);
    useSmoothScroll(scroller, 'db-data__scroll--moving');

    const pkCols = table.primaryKey ?? [];
    const canEdit = !readOnly && pkCols.length > 0;

    // Another table: start over, restoring what was kept for it.
    useEffect(() => {
        setOffset(0);
        setOrderBy('');
        setDesc(false);
        setInput('');
        setSearch('');
        setSearchColumn('');
        setSearchMode('prefix');
        setLoaded(null);
        setEditing(null);
        setWidths(widthStore.get(tableKey) ?? {});
        setPending(pendingStore.get(tableKey) ?? new Map());
    }, [tableKey]);

    const updatePending = useCallback(
        (next: Map<string, RowEdit>) => {
            if (next.size) pendingStore.set(tableKey, next);
            else pendingStore.delete(tableKey);
            setPending(next);
        },
        [tableKey]
    );

    // Debounce the search box so each keystroke is not a query.
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch((cur) => {
                if (cur !== input.trim()) setOffset(0);
                return input.trim();
            });
        }, 300);
        return () => clearTimeout(t);
    }, [input]);

    const load = useCallback(() => {
        const mine = ++seq.current;
        setLoading(true);
        DBBrowse(
            connectionId,
            orm.BrowseRequest.createFrom({ schema: table.schema, table: table.name, limit: PAGE_SIZE, offset, orderBy, desc, search, searchColumn, searchMode })
        )
            .then((p) => {
                if (mine !== seq.current) return;
                setLoaded({ key: tableKey, page: p });
                setError('');
            })
            .catch((err) => {
                if (mine !== seq.current) return;
                setError(errText(err));
            })
            .finally(() => {
                if (mine === seq.current) setLoading(false);
            });
    }, [connectionId, table.schema, table.name, tableKey, offset, orderBy, desc, search, searchColumn, searchMode]);

    useEffect(load, [load]);

    // A new page, order or search starts at the top, gliding.
    useEffect(() => {
        scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, [offset, orderBy, desc, search, searchColumn, searchMode, tableKey]);

    function sortBy(col: string) {
        setOffset(0);
        if (orderBy !== col) {
            setOrderBy(col);
            setDesc(false);
        } else if (!desc) {
            setDesc(true);
        } else {
            setOrderBy('');
            setDesc(false);
        }
    }

    const numeric = table.columns.map((c) => NUMERIC.test(c.type));
    const defaultWidth = (i: number) => (numeric[i] ? 120 : 180);
    const widthOf = (i: number) => widths[table.columns[i].name] ?? defaultWidth(i);

    function setWidth(name: string, w: number | null) {
        setWidths((prev) => {
            const next = { ...prev };
            if (w === null) delete next[name];
            else next[name] = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
            widthStore.set(tableKey, next);
            return next;
        });
    }

    function startResize(e: React.PointerEvent<HTMLSpanElement>, i: number) {
        e.preventDefault();
        e.stopPropagation();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startW = widthOf(i);
        const name = table.columns[i].name;
        const move = (ev: PointerEvent) => setWidth(name, startW + ev.clientX - startX);
        const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    }

    // ---- editing ----

    const pkIdx = pkCols.map((n) => table.columns.findIndex((c) => c.name === n));

    function rowKey(row: (string | null)[]): { id: string; key: Record<string, string> } | null {
        const key: Record<string, string> = {};
        for (let k = 0; k < pkCols.length; k++) {
            const v = row[pkIdx[k]];
            if (v === null || v === undefined) return null;
            key[pkCols[k]] = v;
        }
        return { id: JSON.stringify(key), key };
    }

    function shown(row: (string | null)[], c: number): string | null {
        const rk = rowKey(row);
        const edit = rk ? pending.get(rk.id) : undefined;
        const name = table.columns[c].name;
        return edit && name in edit.set ? edit.set[name] : row[c];
    }

    function editable(row: (string | null)[], c: number): boolean {
        const col = table.columns[c];
        if (!canEdit || col.primaryKey || BINARY.test(col.type)) return false;
        const orig = row[c];
        if (orig !== null && orig.length >= TRUNCATED_LEN) return false;
        return rowKey(row) !== null;
    }

    function commit(row: (string | null)[], c: number, value: string | null) {
        setEditing(null);
        const rk = rowKey(row);
        if (!rk) return;
        const name = table.columns[c].name;
        const next = new Map(pending);
        const edit: RowEdit = { key: rk.key, set: { ...(next.get(rk.id)?.set ?? {}) } };
        if (value === row[c]) delete edit.set[name];
        else edit.set[name] = value;
        if (Object.keys(edit.set).length) next.set(rk.id, edit);
        else next.delete(rk.id);
        updatePending(next);
    }

    const changeCount = [...pending.values()].reduce((n, e) => n + Object.keys(e.set).length, 0);

    async function save() {
        const rows = pending.size;
        const label = table.schema && table.schema !== 'public' ? `${table.schema}.${table.name}` : table.name;
        const ok = await confirm(
            `Salvar ${changeCount} ${changeCount === 1 ? 'alteração' : 'alterações'} em ${rows} ${rows === 1 ? 'linha' : 'linhas'} de "${label}"? Os valores serão gravados no banco, tudo ou nada.`
        );
        if (!ok) return;
        setSaving(true);
        setError('');
        try {
            await DBUpdate(
                connectionId,
                orm.UpdateRequest.createFrom({
                    schema: table.schema,
                    table: table.name,
                    changes: [...pending.values()].map((e) => ({
                        key: e.key,
                        set: Object.entries(e.set).map(([column, value]) => ({ column, value })),
                    })),
                })
            );
            updatePending(new Map());
            load();
        } catch (err) {
            setError(errText(err));
        } finally {
            setSaving(false);
        }
    }

    const rows = page?.rows ?? [];
    const first = rows.length ? offset + 1 : 0;
    const totalWidth = table.columns.reduce((sum, _c, i) => sum + widthOf(i), 0);

    return (
        <div className="db-data">
            <div className="db-data__bar">
                <div className="port-search db-data__search">
                    <SearchIcon size={14} className="port-search__icon" />
                    <input
                        type="text"
                        className="port-search__input"
                        placeholder={searchMode === 'contains' && !searchColumn ? 'Escolha uma coluna' : 'Buscar nas linhas'}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        aria-label="Buscar nas linhas da tabela"
                    />
                </div>
                <Select
                    active={Boolean(searchColumn)}
                    value={searchColumn}
                    ariaLabel="Coluna da busca"
                    options={[{ value: '', label: 'Colunas indexadas' }, ...table.columns.map((c) => ({ value: c.name, label: c.name }))]}
                    onChange={(v) => {
                        setSearchColumn(v);
                        setOffset(0);
                    }}
                />
                <Select
                    active={searchMode === 'contains'}
                    value={searchMode}
                    ariaLabel="Tipo de busca"
                    options={[
                        { value: 'prefix', label: 'Começa com' },
                        { value: 'exact', label: 'Igual' },
                        { value: 'contains', label: 'Contém (lento)' },
                    ]}
                    onChange={(v) => {
                        setSearchMode(v as 'prefix' | 'exact' | 'contains');
                        setOffset(0);
                    }}
                />
                <button className="action-key" onClick={load} disabled={loading || saving}>
                    Atualizar
                </button>
            </div>
            {search && page?.searchNote && <p className="db-muted db-data__note">{page.searchNote}</p>}

            {error && (
                <p className="alert" role="alert">
                    <span className="ssh-notice__text">{error}</span>
                    <button className="ssh-notice__close" onClick={() => setError('')} aria-label="Dispensar aviso">
                        ×
                    </button>
                </p>
            )}

            {changeCount > 0 ? (
                <div className="db-save" role="status">
                    <span>
                        {changeCount} {changeCount === 1 ? 'alteração pendente' : 'alterações pendentes'}
                    </span>
                    <div className="row-actions">
                        <button className="action-key" onClick={() => updatePending(new Map())} disabled={saving}>
                            Descartar
                        </button>
                        <button className="action-key ssh-primary" onClick={save} disabled={saving}>
                            {saving ? 'Salvando…' : 'Salvar alterações'}
                        </button>
                    </div>
                </div>
            ) : (
                (readOnly || pkCols.length === 0) && (
                    <p className="db-muted db-data__hint">
                        {readOnly
                            ? 'Conexão somente leitura. Para editar os dados, desmarque "somente leitura" em Editar conexão.'
                            : 'Esta tabela não tem chave primária, então os dados só podem ser lidos.'}
                    </p>
                )
            )}

            <div className="db-data__scroll" ref={scroller} aria-busy={loading}>
                <table className="db-grid" style={{ width: totalWidth }}>
                    <colgroup>
                        {table.columns.map((c, i) => (
                            <col key={c.name} style={{ width: widthOf(i) }} />
                        ))}
                    </colgroup>
                    <thead>
                        <tr>
                            {table.columns.map((c, i) => {
                                const on = orderBy === c.name;
                                return (
                                    <th
                                        key={c.name}
                                        className={numeric[i] ? 'db-grid__num' : undefined}
                                        aria-sort={on ? (desc ? 'descending' : 'ascending') : 'none'}
                                    >
                                        <button className="db-grid__sort" onClick={() => sortBy(c.name)} title={`Ordenar por ${c.name}`}>
                                            <span className="db-grid__name">{c.name}</span>
                                            {c.primaryKey && <span className="db-grid__pk">PK</span>}
                                            <span className="db-grid__arrow" aria-hidden="true">
                                                {on ? (desc ? '▼' : '▲') : ''}
                                            </span>
                                        </button>
                                        <span
                                            className="db-grid__resize"
                                            role="separator"
                                            aria-orientation="vertical"
                                            aria-label={`Largura da coluna ${c.name}`}
                                            title="Arraste para redimensionar; duplo clique restaura"
                                            onPointerDown={(e) => startResize(e, i)}
                                            onDoubleClick={() => setWidth(c.name, null)}
                                        />
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className={loading ? 'db-grid--loading' : undefined}>
                        {rows.map((row, r) => (
                            <tr key={offset + r}>
                                {row.map((_orig, c) => {
                                    const value = shown(row, c);
                                    const col = table.columns[c];
                                    const can = editable(row, c);
                                    const rk = rowKey(row);
                                    const changed = !!(rk && pending.get(rk.id) && col.name in pending.get(rk.id)!.set);
                                    const isEditing = editing?.r === r && editing.c === c;
                                    const cls = [
                                        numeric[c] ? 'db-grid__num' : '',
                                        can ? 'db-grid__cell--editable' : '',
                                        changed ? 'db-grid__cell--changed' : '',
                                        isEditing ? 'db-grid__cell--editing' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ');
                                    return (
                                        <td
                                            key={c}
                                            className={cls || undefined}
                                            title={isEditing ? undefined : value ?? 'NULL'}
                                            onClick={() => can && !isEditing && setEditing({ r, c })}
                                        >
                                            {isEditing ? (
                                                <CellEditor
                                                    initial={value}
                                                    nullable={col.nullable}
                                                    onCommit={(v) => commit(row, c, v)}
                                                    onCancel={() => setEditing(null)}
                                                />
                                            ) : value === null ? (
                                                <span className="db-grid__null">NULL</span>
                                            ) : (
                                                value
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!loading && !error && rows.length === 0 && (
                    <p className="db-muted db-data__empty">{search ? 'Nenhuma linha corresponde à busca.' : 'Esta tabela está vazia.'}</p>
                )}
                {loading && !page && <p className="db-muted db-data__empty">Lendo as linhas...</p>}
            </div>

            <div className="db-data__pager">
                <span className="db-muted">{rows.length ? `Linhas ${first.toLocaleString('pt-BR')}–${(offset + rows.length).toLocaleString('pt-BR')}` : ''}</span>
                <div className="row-actions">
                    <button className="action-key" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={loading || offset === 0}>
                        Anterior
                    </button>
                    <button className="action-key" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={loading || !page?.hasMore}>
                        Próxima
                    </button>
                </div>
            </div>
        </div>
    );
}

interface CellEditorProps {
    initial: string | null;
    nullable: boolean;
    onCommit: (value: string | null) => void;
    onCancel: () => void;
}

/** The text box of a cell being edited. Enter or leaving it keeps the value, Esc drops it. */
function CellEditor({ initial, nullable, onCommit, onCancel }: CellEditorProps) {
    const [value, setValue] = useState(initial ?? '');
    // Enter, Esc and the NULL button each finish the edit; the blur that follows must not finish it twice.
    const done = useRef(false);

    function finish(v: string | null) {
        if (done.current) return;
        done.current = true;
        onCommit(v);
    }

    return (
        <div className="db-cell-edit">
            <input
                className="db-cell-edit__input"
                autoFocus
                value={value}
                placeholder={initial === null ? 'NULL' : undefined}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') finish(initial === null && value === '' ? null : value);
                    else if (e.key === 'Escape') {
                        done.current = true;
                        onCancel();
                    }
                }}
                onBlur={() => finish(initial === null && value === '' ? null : value)}
                aria-label="Novo valor"
            />
            {nullable && (
                <button
                    type="button"
                    className="db-cell-edit__null"
                    title="Gravar NULL"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => finish(null)}
                >
                    NULL
                </button>
            )}
        </div>
    );
}

export default DataGrid;

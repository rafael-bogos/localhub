import { useCallback, useEffect, useRef, useState } from 'react';
import { DBBrowse } from '../../wailsjs/go/main/App';
import { orm } from '../../wailsjs/go/models';
import { SearchIcon } from './icons';

const PAGE_SIZE = 50;

const errText = (err: unknown) => String(err).replace(/^Error:\s*/, '');

const NUMERIC = /^(smallint|integer|int|int\d|bigint|tinyint|mediumint|serial|bigserial|numeric|decimal|real|double|float)/i;

interface DataGridProps {
    connectionId: string;
    table: orm.Table;
}

/** Real rows of one table: paged, sortable by column, searchable. Read-only. */
function DataGrid({ connectionId, table }: DataGridProps) {
    const [page, setPage] = useState<orm.Page | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [offset, setOffset] = useState(0);
    const [orderBy, setOrderBy] = useState('');
    const [desc, setDesc] = useState(false);
    const [input, setInput] = useState('');
    const [search, setSearch] = useState('');
    // Only the newest request may update the grid (fast typing, fast paging).
    const seq = useRef(0);

    // Another table: start over.
    useEffect(() => {
        setOffset(0);
        setOrderBy('');
        setDesc(false);
        setInput('');
        setSearch('');
        setPage(null);
    }, [connectionId, table.schema, table.name]);

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
            orm.BrowseRequest.createFrom({ schema: table.schema, table: table.name, limit: PAGE_SIZE, offset, orderBy, desc, search })
        )
            .then((p) => {
                if (mine !== seq.current) return;
                setPage(p);
                setError('');
            })
            .catch((err) => {
                if (mine !== seq.current) return;
                setError(errText(err));
            })
            .finally(() => {
                if (mine === seq.current) setLoading(false);
            });
    }, [connectionId, table.schema, table.name, offset, orderBy, desc, search]);

    useEffect(load, [load]);

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
    const rows = page?.rows ?? [];
    const first = rows.length ? offset + 1 : 0;

    return (
        <div className="db-data">
            <div className="db-data__bar">
                <div className="port-search db-data__search">
                    <SearchIcon size={14} className="port-search__icon" />
                    <input
                        type="text"
                        className="port-search__input"
                        placeholder="Buscar nas linhas"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        aria-label="Buscar nas linhas da tabela"
                    />
                </div>
                <button className="action-key" onClick={load} disabled={loading}>
                    Atualizar
                </button>
            </div>

            {error && (
                <p className="alert" role="alert">
                    <span className="ssh-notice__text">{error}</span>
                </p>
            )}

            <div className="db-data__scroll" aria-busy={loading}>
                <table className="db-grid">
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
                                            {c.name}
                                            {c.primaryKey && <span className="db-grid__pk">PK</span>}
                                            <span className="db-grid__arrow" aria-hidden="true">
                                                {on ? (desc ? '▼' : '▲') : ''}
                                            </span>
                                        </button>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className={loading ? 'db-grid--loading' : undefined}>
                        {rows.map((row, r) => (
                            <tr key={offset + r}>
                                {row.map((cell, i) => (
                                    <td key={i} className={numeric[i] ? 'db-grid__num' : undefined} title={cell ?? 'NULL'}>
                                        {cell === null || cell === undefined ? <span className="db-grid__null">NULL</span> : cell}
                                    </td>
                                ))}
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

export default DataGrid;

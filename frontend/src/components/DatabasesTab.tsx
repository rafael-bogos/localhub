import { useCallback, useEffect, useMemo, useState } from 'react';
import { DBConnect, DBConnected, DBDisconnect, DBIntrospect, DBOpenContainer } from '../../wailsjs/go/main/App';
import type { orm } from '../../wailsjs/go/models';
import { DB_KIND_LABEL, type DbConnectionsApi, type DbProfile } from '../useDbConnections';
import { matchesSearch } from '../search';
import { useConfirm } from './ConfirmDialog';
import DataGrid from './DataGrid';
import DbConnectionDialog from './DbConnectionDialog';
import { ChevronIcon, SearchIcon } from './icons';

const errText = (err: unknown) => String(err).replace(/^Error:\s*/, '');

function tableLabel(t: orm.Table): string {
    return t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
}

function rowsLabel(n: number): string {
    if (n < 0) return '';
    return n === 1 ? '~1 linha' : `~${n.toLocaleString('pt-BR')} linhas`;
}

interface DatabasesTabProps {
    api: DbConnectionsApi;
    /** A container's database to open right away (from the Containers tab). */
    request?: DbProfile | null;
    onRequestHandled?: () => void;
}

/** Saved database connections, and the structure of the one that is open. */
function DatabasesTab({ api, request, onRequestHandled }: DatabasesTabProps) {
    const confirm = useConfirm();
    const { profiles } = api;
    const [editing, setEditing] = useState<DbProfile | 'new' | null>(null);
    const [connected, setConnected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);

    // The backend keeps connections open across tab switches and hot reloads.
    useEffect(() => {
        DBConnected()
            .then((ids) => setConnected(new Set(ids ?? [])))
            .catch(() => {});
    }, []);

    const connect = useCallback(async (p: DbProfile): Promise<boolean> => {
        setBusy(p.id);
        setNotice('');
        try {
            await DBConnect({ ...p });
            setConnected((prev) => new Set(prev).add(p.id));
            return true;
        } catch (err) {
            setNotice(`${p.name}: ${errText(err)}`);
            return false;
        } finally {
            setBusy(null);
        }
    }, []);

    const disconnect = useCallback((id: string) => {
        DBDisconnect(id);
        setConnected((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
        setOpenId((cur) => (cur === id ? null : cur));
    }, []);

    async function open(p: DbProfile) {
        let target = p;
        if (p.origin) {
            // A container's address changes (tunnel port, published port): ask again.
            setBusy(p.id);
            setNotice('');
            try {
                const found = await DBOpenContainer(p.origin.hostId, p.origin.container);
                target = api.upsertFromContainer(p.origin, { ...p, host: found.host, port: found.port }) ?? p;
            } catch (err) {
                setNotice(`${p.name}: ${errText(err)}`);
                setBusy(null);
                return;
            }
            setBusy(null);
        }
        // The address may have changed under an open connection: reconnect then.
        if (target.host !== p.host || target.port !== p.port || !connected.has(target.id)) {
            if (!(await connect(target))) return;
        }
        setOpenId(target.id);
    }

    // The Containers tab asked to open one of its databases.
    useEffect(() => {
        if (!request) return;
        onRequestHandled?.();
        (async () => {
            if (!connected.has(request.id) && !(await connect(request))) return;
            setOpenId(request.id);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request]);

    async function remove(p: DbProfile) {
        if (!(await confirm(`Remover a conexão "${p.name}"? O banco em si não é alterado.`))) return;
        if (connected.has(p.id)) disconnect(p.id);
        api.remove(p.id);
    }

    function save(draft: Parameters<DbConnectionsApi['add']>[0]) {
        if (editing === 'new') {
            api.add(draft);
        } else if (editing) {
            // Edited settings only apply to a fresh connection.
            if (connected.has(editing.id)) disconnect(editing.id);
            api.update(editing.id, { ...draft, origin: editing.origin });
        }
        setEditing(null);
    }

    const openProfile = profiles.find((p) => p.id === openId);

    return (
        <div className="ssh-tab db-tab">
            {notice && (
                <p className="alert" role="alert">
                    <span className="ssh-notice__text">{notice}</span>
                    <button className="ssh-notice__close" onClick={() => setNotice('')} aria-label="Dispensar aviso">
                        ×
                    </button>
                </p>
            )}

            {openProfile ? (
                <SchemaView profile={openProfile} onBack={() => setOpenId(null)} onDisconnect={() => disconnect(openProfile.id)} onError={setNotice} />
            ) : profiles.length === 0 ? (
                <div className="empty-state">
                    <p>Nenhuma conexão salva. Conecte num PostgreSQL ou MySQL para ver as tabelas.</p>
                    <div className="row-actions">
                        <button className="action-key ssh-primary" onClick={() => setEditing('new')}>
                            Nova conexão
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="ssh-toolbar">
                        <div className="ssh-toolbar__actions">
                            <button className="action-key ssh-primary" onClick={() => setEditing('new')}>
                                Nova conexão
                            </button>
                        </div>
                    </div>
                    <table className="ssh-table">
                        <thead>
                            <tr>
                                <th>Conexão</th>
                                <th>Endereço</th>
                                <th>Tipo</th>
                                <th>Estado</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {profiles.map((p) => {
                                const isOn = connected.has(p.id);
                                const isBusy = busy === p.id;
                                return (
                                    <tr key={p.id} className="ssh-row">
                                        <td className="ssh-row__name">{p.name}</td>
                                        <td className="ssh-row__addr" data-label="Endereço">
                                            {p.user}@{p.host}:{p.port}/{p.database}
                                        </td>
                                        <td className="ssh-row__method" data-label="Tipo">
                                            {DB_KIND_LABEL[p.kind]}
                                            {p.origin ? (p.origin.hostId ? ' · servidor' : ' · container') : ''}
                                            {p.readOnly ? ' · leitura' : ''}
                                        </td>
                                        <td data-label="Estado">
                                            {(isOn || isBusy) && (
                                                <span className={`status-chip${isOn ? ' status-chip--listen' : ''}`}>
                                                    {isBusy ? 'Conectando' : 'Conectado'}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <div className="row-actions ssh-row__actions">
                                                <button className="action-key ssh-primary" onClick={() => open(p)} disabled={isBusy}>
                                                    {isBusy ? 'Acessando...' : 'Acessar'}
                                                </button>
                                                <button className="action-key" onClick={() => setEditing(p)} disabled={isBusy}>
                                                    Editar
                                                </button>
                                                <button className="kill-key" onClick={() => remove(p)} disabled={isBusy}>
                                                    Remover
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </>
            )}

            {editing && (
                <DbConnectionDialog
                    initial={editing === 'new' ? undefined : editing}
                    onSave={save}
                    onCancel={() => setEditing(null)}
                />
            )}
        </div>
    );
}

interface SchemaViewProps {
    profile: DbProfile;
    onBack: () => void;
    onDisconnect: () => void;
    onError: (message: string) => void;
}

/** Tables on the left, the selected table's columns, indexes and foreign keys on the right. */
function SchemaView({ profile, onBack, onDisconnect, onError }: SchemaViewProps) {
    const [schema, setSchema] = useState<orm.Schema | null>(null);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        DBIntrospect(profile.id)
            .then((s) => {
                setSchema(s);
                setSelected((cur) => cur ?? (s.tables[0] ? tableLabel(s.tables[0]) : null));
            })
            .catch((err) => onError(`${profile.name}: ${errText(err)}`))
            .finally(() => setLoading(false));
    }, [profile.id, profile.name, onError]);

    useEffect(load, [load]);

    const tables = useMemo(
        () => (schema?.tables ?? []).filter((t) => !query.trim() || matchesSearch(query, tableLabel(t))),
        [schema, query]
    );
    const table = schema?.tables.find((t) => tableLabel(t) === selected) ?? null;

    return (
        <div className="db-schema">
            <div className="ssh-terminal-bar">
                <button className="action-key" onClick={onBack}>
                    <ChevronIcon size={12} className="ssh-back-icon" /> Conexões
                </button>
                <div className="ssh-terminal-bar__id">
                    <span className="ssh-terminal-bar__name">{profile.name}</span>
                    <span className="ssh-terminal-bar__addr">
                        {DB_KIND_LABEL[profile.kind]} · {profile.database}
                    </span>
                </div>
                <div className="row-actions ssh-terminal-bar__actions">
                    <button className="action-key" onClick={load} disabled={loading}>
                        Atualizar
                    </button>
                    <button className="kill-key" onClick={onDisconnect}>
                        Desconectar
                    </button>
                </div>
            </div>

            {loading && !schema ? (
                <p className="db-muted">Lendo a estrutura do banco...</p>
            ) : !schema || schema.tables.length === 0 ? (
                <div className="empty-state">
                    <p>Este banco não tem tabelas.</p>
                </div>
            ) : (
                <div className="db-split">
                    <aside className="db-tables">
                        <div className="port-search">
                            <SearchIcon size={14} className="port-search__icon" />
                            <input
                                type="text"
                                className="port-search__input"
                                placeholder="Buscar tabela"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                aria-label="Buscar tabela"
                            />
                        </div>
                        <ul className="db-tables__list">
                            {tables.map((t) => {
                                const label = tableLabel(t);
                                return (
                                    <li key={label}>
                                        <button
                                            className={`db-tables__item${label === selected ? ' db-tables__item--on' : ''}`}
                                            onClick={() => setSelected(label)}
                                        >
                                            <span className="db-tables__name">{label}</span>
                                            <span className="db-tables__meta">{rowsLabel(t.rowEstimate)}</span>
                                        </button>
                                    </li>
                                );
                            })}
                            {tables.length === 0 && <li className="db-muted">Nenhuma tabela corresponde.</li>}
                        </ul>
                    </aside>
                    {table && <TableView connectionId={profile.id} table={table} />}
                </div>
            )}
        </div>
    );
}

/** One table, as its rows ("Dados") or its structure ("Estrutura"). */
function TableView({ connectionId, table }: { connectionId: string; table: orm.Table }) {
    const [view, setView] = useState<'data' | 'structure'>('data');
    return (
        <section className="db-detail" aria-label={tableLabel(table)}>
            <div className="db-detail__head">
                <h3 className="db-detail__title">{tableLabel(table)}</h3>
                <div className="db-tabs" role="tablist">
                    <button role="tab" aria-selected={view === 'data'} className={`db-tabs__tab${view === 'data' ? ' db-tabs__tab--on' : ''}`} onClick={() => setView('data')}>
                        Dados
                    </button>
                    <button role="tab" aria-selected={view === 'structure'} className={`db-tabs__tab${view === 'structure' ? ' db-tabs__tab--on' : ''}`} onClick={() => setView('structure')}>
                        Estrutura
                    </button>
                </div>
            </div>
            {view === 'data' ? <DataGrid connectionId={connectionId} table={table} /> : <TableDetail table={table} />}
        </section>
    );
}

function TableDetail({ table }: { table: orm.Table }) {
    return (
        <div>
            <table className="ssh-table db-cols">
                <thead>
                    <tr>
                        <th>Coluna</th>
                        <th>Tipo</th>
                        <th>Nulo</th>
                        <th>Padrão</th>
                    </tr>
                </thead>
                <tbody>
                    {table.columns.map((c) => (
                        <tr key={c.name} className="ssh-row">
                            <td className="ssh-row__name">
                                {c.name}
                                {c.primaryKey && <span className="status-chip status-chip--listen db-chip">PK</span>}
                            </td>
                            <td className="ssh-row__addr" data-label="Tipo">
                                {c.type}
                            </td>
                            <td data-label="Nulo">{c.nullable ? 'sim' : 'não'}</td>
                            <td className="ssh-row__addr" data-label="Padrão">
                                {c.autoIncrement ? 'auto incremento' : c.hasDefault ? c.default : ''}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {table.indexes.length > 0 && (
                <>
                    <h4 className="db-detail__sub">Índices</h4>
                    <ul className="db-list">
                        {table.indexes.map((i) => (
                            <li key={i.name}>
                                <span className="db-list__name">{i.name}</span>
                                <span className="db-list__meta">
                                    ({i.columns.join(', ')}){i.unique ? ' · único' : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {table.foreignKeys.length > 0 && (
                <>
                    <h4 className="db-detail__sub">Chaves estrangeiras</h4>
                    <ul className="db-list">
                        {table.foreignKeys.map((f) => (
                            <li key={f.name}>
                                <span className="db-list__name">{f.columns.join(', ')}</span>
                                <span className="db-list__meta">
                                    → {f.refSchema && f.refSchema !== 'public' ? `${f.refSchema}.` : ''}
                                    {f.refTable}({f.refColumns.join(', ')}) · ao excluir: {f.onDelete}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}

export default DatabasesTab;

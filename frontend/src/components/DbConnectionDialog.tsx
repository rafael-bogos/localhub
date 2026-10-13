import { useEffect, useState, type FormEvent } from 'react';
import { DBTest } from '../../wailsjs/go/main/App';
import { orm } from '../../wailsjs/go/models';
import {
    DB_KIND_LABEL,
    defaultPort,
    type DbKind,
    type DbProfile,
    type DbProfileDraft,
    type DbSsl,
} from '../useDbConnections';

interface DbConnectionDialogProps {
    /** Connection being edited; undefined creates a new one. */
    initial?: DbProfile;
    onSave: (draft: DbProfileDraft) => void;
    onCancel: () => void;
}

function DbConnectionDialog({ initial, onSave, onCancel }: DbConnectionDialogProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [kind, setKind] = useState<DbKind>(initial?.kind ?? 'postgres');
    const [host, setHost] = useState(initial?.host ?? 'localhost');
    const [port, setPort] = useState(String(initial?.port ?? defaultPort('postgres')));
    const [database, setDatabase] = useState(initial?.database ?? '');
    const [user, setUser] = useState(initial?.user ?? '');
    const [password, setPassword] = useState(initial?.password ?? '');
    const [ssl, setSsl] = useState<DbSsl>(initial?.ssl ?? 'off');
    const [readOnly, setReadOnly] = useState(initial?.readOnly ?? false);
    const [error, setError] = useState('');
    const [testing, setTesting] = useState(false);
    const [tested, setTested] = useState(false);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    // An old error or test result no longer applies once a field changes.
    useEffect(() => {
        setError('');
        setTested(false);
    }, [kind, host, port, database, user, password, ssl]);

    // Switching engine moves the port only while it still holds the other engine's default.
    function chooseKind(next: DbKind) {
        if (Number(port) === defaultPort(kind)) setPort(String(defaultPort(next)));
        setKind(next);
    }

    function draft(): DbProfileDraft | string {
        const portNum = Number(port);
        if (!host.trim()) return 'Informe o endereço (host) do banco.';
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return 'A porta deve estar entre 1 e 65535.';
        if (!database.trim()) return 'Informe o nome do banco.';
        if (!user.trim()) return 'Informe o usuário.';
        return {
            name: name.trim() || `${database.trim()}@${host.trim()}`,
            kind,
            host: host.trim(),
            port: portNum,
            database: database.trim(),
            user: user.trim(),
            password,
            ssl,
            readOnly,
        };
    }

    async function test() {
        const d = draft();
        if (typeof d === 'string') return setError(d);
        setTesting(true);
        setError('');
        setTested(false);
        try {
            await DBTest(orm.Profile.createFrom({ ...d, id: initial?.id ?? '' }));
            setTested(true);
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            setTesting(false);
        }
    }

    function submit(e: FormEvent) {
        e.preventDefault();
        const d = draft();
        if (typeof d === 'string') return setError(d);
        onSave(d);
    }

    return (
        <div className="confirm-overlay" onClick={onCancel}>
            <form
                className="confirm-modal ssh-form"
                role="dialog"
                aria-modal="true"
                aria-label={initial ? 'Editar conexão' : 'Nova conexão'}
                onClick={(e) => e.stopPropagation()}
                onSubmit={submit}
            >
                <h2 className="ssh-form__title">{initial ? 'Editar conexão' : 'Nova conexão'}</h2>

                <div className="ssh-field">
                    <span className="ssh-field__label">Tipo</span>
                    <div className="ssh-segment" role="radiogroup" aria-label="Tipo do banco">
                        {(Object.keys(DB_KIND_LABEL) as DbKind[]).map((k) => (
                            <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={kind === k}
                                className={`ssh-segment__opt${kind === k ? ' ssh-segment__opt--on' : ''}`}
                                onClick={() => chooseKind(k)}
                            >
                                {DB_KIND_LABEL[k]}
                            </button>
                        ))}
                    </div>
                </div>

                <label className="ssh-field">
                    <span className="ssh-field__label">Nome</span>
                    <input
                        className="ssh-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex.: app local (opcional)"
                        autoFocus
                    />
                </label>

                <div className="ssh-form__row">
                    <label className="ssh-field ssh-field--grow">
                        <span className="ssh-field__label">Endereço</span>
                        <input
                            className="ssh-input ssh-input--mono"
                            value={host}
                            onChange={(e) => setHost(e.target.value)}
                            placeholder="localhost"
                            spellCheck={false}
                            autoCapitalize="off"
                        />
                    </label>
                    <label className="ssh-field ssh-field--port">
                        <span className="ssh-field__label">Porta</span>
                        <input
                            className="ssh-input ssh-input--mono"
                            value={port}
                            onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                            inputMode="numeric"
                            aria-label="Porta do banco"
                        />
                    </label>
                </div>

                <label className="ssh-field">
                    <span className="ssh-field__label">Banco</span>
                    <input
                        className="ssh-input ssh-input--mono"
                        value={database}
                        onChange={(e) => setDatabase(e.target.value)}
                        placeholder="nome do banco de dados"
                        spellCheck={false}
                        autoCapitalize="off"
                    />
                </label>

                <div className="ssh-form__row">
                    <label className="ssh-field ssh-field--grow">
                        <span className="ssh-field__label">Usuário</span>
                        <input
                            className="ssh-input ssh-input--mono"
                            value={user}
                            onChange={(e) => setUser(e.target.value)}
                            spellCheck={false}
                            autoCapitalize="off"
                        />
                    </label>
                    <label className="ssh-field ssh-field--grow">
                        <span className="ssh-field__label">Senha</span>
                        <input
                            className="ssh-input ssh-input--mono"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="off"
                        />
                    </label>
                </div>
                <p className="ssh-field__hint">
                    A senha fica salva em texto no arquivo de configurações deste computador, sem criptografia.
                </p>

                <div className="ssh-field">
                    <span className="ssh-field__label">Conexão segura (SSL)</span>
                    <div className="ssh-segment" role="radiogroup" aria-label="SSL">
                        {(['off', 'require'] as DbSsl[]).map((m) => (
                            <button
                                key={m}
                                type="button"
                                role="radio"
                                aria-checked={ssl === m}
                                className={`ssh-segment__opt${ssl === m ? ' ssh-segment__opt--on' : ''}`}
                                onClick={() => setSsl(m)}
                            >
                                {m === 'off' ? 'Desligado' : 'Exigir'}
                            </button>
                        ))}
                    </div>
                    {ssl === 'off' && host.trim() && !/^(localhost|127\.|::1$)/i.test(host.trim()) && (
                        <p className="ssh-field__hint">
                            Este banco não está neste computador: sem SSL, a senha e os dados trafegam sem criptografia.
                        </p>
                    )}
                </div>

                <label className="db-check">
                    <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
                    <span>Somente leitura (bloqueia qualquer alteração por este app)</span>
                </label>

                {error && (
                    <p className="ssh-form__error" role="alert">
                        {error}
                    </p>
                )}
                {tested && (
                    <p className="ssh-field__hint" role="status">
                        Conexão funcionando.
                    </p>
                )}

                <div className="confirm-modal__actions">
                    <button type="button" className="action-key" onClick={test} disabled={testing}>
                        {testing ? 'Testando...' : 'Testar conexão'}
                    </button>
                    <button type="button" className="action-key" onClick={onCancel}>
                        Cancelar
                    </button>
                    <button type="submit" className="action-key ssh-primary">
                        Salvar
                    </button>
                </div>
            </form>
        </div>
    );
}

export default DbConnectionDialog;

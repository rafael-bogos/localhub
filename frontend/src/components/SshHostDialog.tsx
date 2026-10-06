import { useEffect, useState, type FormEvent } from 'react';
import { PickFile } from '../../wailsjs/go/main/App';
import { DEFAULT_PORT, type SshHost, type SshHostDraft, type SshMethod } from '../useSshHosts';

interface SshHostDialogProps {
    /** Server being edited; undefined creates a new one. */
    initial?: SshHost;
    onSave: (draft: SshHostDraft) => void;
    onCancel: () => void;
}

function SshHostDialog({ initial, onSave, onCancel }: SshHostDialogProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [address, setAddress] = useState(initial?.address ?? '');
    const [port, setPort] = useState(String(initial?.port ?? DEFAULT_PORT));
    const [user, setUser] = useState(initial?.user ?? '');
    const [method, setMethod] = useState<SshMethod>(initial?.method ?? 'key');
    const [keyPath, setKeyPath] = useState(initial?.keyPath ?? '');
    const [error, setError] = useState('');

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    // An old error no longer applies once the user changes a field.
    useEffect(() => {
        setError('');
    }, [name, address, port, user, method, keyPath]);

    async function pickKey() {
        try {
            const path = await PickFile();
            if (path) setKeyPath(path);
        } catch (err) {
            setError(String(err));
        }
    }

    function submit(e: FormEvent) {
        e.preventDefault();
        const portNum = Number(port);
        if (!address.trim()) return setError('Informe o endereço do servidor.');
        if (!user.trim()) return setError('Informe o usuário.');
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
            return setError('A porta SSH deve estar entre 1 e 65535.');
        }
        if (method === 'key' && !keyPath.trim()) return setError('Escolha o arquivo da chave privada.');

        onSave({
            name: name.trim() || address.trim(),
            address: address.trim(),
            port: portNum,
            user: user.trim(),
            method,
            keyPath: method === 'key' ? keyPath.trim() : '',
        });
    }

    return (
        <div className="confirm-overlay" onClick={onCancel}>
            <form
                className="confirm-modal ssh-form"
                role="dialog"
                aria-modal="true"
                aria-label={initial ? 'Editar servidor' : 'Novo servidor'}
                onClick={(e) => e.stopPropagation()}
                onSubmit={submit}
            >
                <h2 className="ssh-form__title">{initial ? 'Editar servidor' : 'Novo servidor'}</h2>

                <label className="ssh-field">
                    <span className="ssh-field__label">Nome</span>
                    <input
                        className="ssh-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex.: prod-01 (opcional)"
                        autoFocus
                    />
                </label>

                <div className="ssh-form__row">
                    <label className="ssh-field ssh-field--grow">
                        <span className="ssh-field__label">Endereço</span>
                        <input
                            className="ssh-input ssh-input--mono"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="192.168.1.50 ou servidor.exemplo.com"
                            spellCheck={false}
                            autoCapitalize="off"
                        />
                    </label>
                    <label className="ssh-field ssh-field--port">
                        <span className="ssh-field__label">Porta SSH</span>
                        <input
                            className="ssh-input ssh-input--mono"
                            value={port}
                            onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                            inputMode="numeric"
                            title="A porta em que o servidor aceita conexões SSH (quase sempre 22)"
                            aria-label="Porta SSH do servidor"
                        />
                    </label>
                </div>
                <p className="ssh-field__hint ssh-form__port-hint">
                    Porta SSH: onde o servidor aceita a conexão SSH. Quase sempre é a 22; mude só se o seu servidor usa outra
                    (o mesmo número do <code>ssh -p</code>).
                </p>

                <label className="ssh-field">
                    <span className="ssh-field__label">Usuário</span>
                    <input
                        className="ssh-input ssh-input--mono"
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                        placeholder="deploy"
                        spellCheck={false}
                        autoCapitalize="off"
                    />
                </label>

                <div className="ssh-field">
                    <span className="ssh-field__label">Login</span>
                    <div className="ssh-segment" role="radiogroup" aria-label="Método de login">
                        <button
                            type="button"
                            role="radio"
                            aria-checked={method === 'key'}
                            className={`ssh-segment__opt${method === 'key' ? ' ssh-segment__opt--on' : ''}`}
                            onClick={() => setMethod('key')}
                        >
                            Chave privada
                        </button>
                        <button
                            type="button"
                            role="radio"
                            aria-checked={method === 'agent'}
                            className={`ssh-segment__opt${method === 'agent' ? ' ssh-segment__opt--on' : ''}`}
                            onClick={() => setMethod('agent')}
                        >
                            ssh-agent
                        </button>
                    </div>
                    <p className="ssh-field__hint">
                        {method === 'key'
                            ? 'Se a chave tiver passphrase, ela é pedida na hora de conectar e nunca é salva.'
                            : 'Usa as chaves já carregadas no agente do sistema (ssh-add).'}
                    </p>
                </div>

                {method === 'key' && (
                    <div className="ssh-field">
                        <span className="ssh-field__label">Arquivo da chave</span>
                        <div className="ssh-form__row">
                            <input
                                className="ssh-input ssh-input--mono ssh-field--grow"
                                value={keyPath}
                                onChange={(e) => setKeyPath(e.target.value)}
                                placeholder="~/.ssh/id_ed25519"
                                spellCheck={false}
                                aria-label="Caminho do arquivo da chave privada"
                            />
                            <button type="button" className="action-key" onClick={pickKey}>
                                Escolher
                            </button>
                        </div>
                    </div>
                )}

                {error && (
                    <p className="ssh-form__error" role="alert">
                        {error}
                    </p>
                )}

                <div className="confirm-modal__actions">
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

export default SshHostDialog;

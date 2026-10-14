import { useEffect, useState, type FormEvent } from 'react';
import { CoolifyTest } from '../../wailsjs/go/main/App';
import { coolify } from '../../wailsjs/go/models';
import type { CoolifyConfig } from '../useCoolify';

interface CoolifyDialogProps {
    /** Where the container runs, for the title ("Esta máquina" or a server's name). */
    machine: string;
    initial?: CoolifyConfig;
    onSave: (cfg: CoolifyConfig) => void;
    onCancel: () => void;
}

/** Address and API token of the Coolify that manages the containers of one machine. */
function CoolifyDialog({ machine, initial, onSave, onCancel }: CoolifyDialogProps) {
    const [url, setUrl] = useState(initial?.url ?? '');
    const [token, setToken] = useState(initial?.token ?? '');
    const [error, setError] = useState('');
    const [testing, setTesting] = useState(false);
    const [team, setTeam] = useState<string | null>(null);

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
        setTeam(null);
    }, [url, token]);

    function draft(): CoolifyConfig | string {
        if (!url.trim()) return 'Informe o endereço do Coolify.';
        if (!token.trim()) return 'Informe o token da API.';
        return { url: url.trim(), token: token.trim() };
    }

    async function test() {
        const d = draft();
        if (typeof d === 'string') return setError(d);
        setTesting(true);
        setError('');
        setTeam(null);
        try {
            setTeam(await CoolifyTest(coolify.Config.createFrom(d)));
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
                aria-label="Conectar ao Coolify"
                onClick={(e) => e.stopPropagation()}
                onSubmit={submit}
            >
                <h2 className="ssh-form__title">Conectar ao Coolify</h2>
                <p className="ssh-field__hint">
                    Os containers de {machine} são gerenciados por um Coolify. Para fazer o redeploy por aqui, informe o endereço dele e um token da API.
                </p>

                <label className="ssh-field">
                    <span className="ssh-field__label">Endereço do Coolify</span>
                    <input
                        className="ssh-input ssh-input--mono"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://coolify.suaempresa.com"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoFocus
                    />
                </label>
                {/^http:\/\//i.test(url.trim()) && (
                    <p className="ssh-field__hint">Com http://, o token trafega sem criptografia. Prefira https://.</p>
                )}

                <label className="ssh-field">
                    <span className="ssh-field__label">Token da API</span>
                    <input
                        className="ssh-input ssh-input--mono"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="1|abc..."
                        autoComplete="off"
                        spellCheck={false}
                    />
                </label>
                <p className="ssh-field__hint">
                    Crie em Coolify → Keys &amp; Tokens → API tokens, com as permissões <strong>read</strong> e <strong>deploy</strong> (e a API habilitada em
                    Settings → Advanced). O token fica salvo em texto no arquivo de configurações deste computador, sem criptografia.
                </p>

                {error && (
                    <p className="ssh-form__error" role="alert">
                        {error}
                    </p>
                )}
                {team !== null && (
                    <p className="ssh-field__hint" role="status">
                        Conexão funcionando{team ? ` (time: ${team})` : ''}.
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
                        Salvar e continuar
                    </button>
                </div>
            </form>
        </div>
    );
}

export default CoolifyDialog;

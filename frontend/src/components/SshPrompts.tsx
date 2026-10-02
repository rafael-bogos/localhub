import { useEffect, useState, type FormEvent } from 'react';
import { AlertIcon } from './icons';
import type { HostKeyPrompt } from '../useSshConnections';

interface PassphrasePromptProps {
    hostName: string;
    keyPath: string;
    /** The previous attempt used a wrong passphrase. */
    retry: boolean;
    onSubmit: (passphrase: string) => void;
    onCancel: () => void;
}

/** Asks for the passphrase of an encrypted key. It is sent once and never stored. */
export function PassphrasePrompt({ hostName, keyPath, retry, onSubmit, onCancel }: PassphrasePromptProps) {
    const [value, setValue] = useState('');

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    function submit(e: FormEvent) {
        e.preventDefault();
        if (value) onSubmit(value);
    }

    return (
        <div className="confirm-overlay" onClick={onCancel}>
            <form
                className="confirm-modal ssh-form"
                role="dialog"
                aria-modal="true"
                aria-label="Passphrase da chave"
                onClick={(e) => e.stopPropagation()}
                onSubmit={submit}
            >
                <h2 className="ssh-form__title">Passphrase da chave</h2>
                <p className="ssh-prompt__text">
                    Conectar a <strong>{hostName}</strong> usa a chave <code>{keyPath}</code>, que é protegida por passphrase.
                </p>
                {retry && (
                    <p className="ssh-form__error" role="alert">
                        Passphrase incorreta. Tente novamente.
                    </p>
                )}
                <input
                    className="ssh-input ssh-input--mono"
                    type="password"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    aria-label="Passphrase"
                    autoComplete="off"
                    autoFocus
                />
                <p className="ssh-field__hint">Usada só nesta conexão. Não é salva.</p>
                <div className="confirm-modal__actions">
                    <button type="button" className="action-key" onClick={onCancel}>
                        Cancelar
                    </button>
                    <button type="submit" className="action-key ssh-primary" disabled={!value}>
                        Conectar
                    </button>
                </div>
            </form>
        </div>
    );
}

interface HostKeyDialogProps {
    prompt: HostKeyPrompt;
    hostName: string;
    onAnswer: (accept: boolean) => void;
}

/** First connection to a server: shows its fingerprint and asks whether to trust it. */
export function HostKeyDialog({ prompt, hostName, onAnswer }: HostKeyDialogProps) {
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onAnswer(false);
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onAnswer]);

    return (
        <div className="confirm-overlay" onClick={() => onAnswer(false)}>
            <div
                className="confirm-modal ssh-form"
                role="alertdialog"
                aria-modal="true"
                aria-label="Confiar no servidor"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="ssh-form__title">Servidor desconhecido</h2>
                <p className="confirm-modal__message">
                    <AlertIcon size={16} />
                    Esta é a primeira conexão com {hostName}. Confira se a impressão digital abaixo é a do servidor
                    antes de confiar.
                </p>
                <dl className="ssh-fingerprint">
                    <dt>Endereço</dt>
                    <dd>{prompt.address}</dd>
                    <dt>Tipo da chave</dt>
                    <dd>{prompt.keyType}</dd>
                    <dt>Impressão digital</dt>
                    <dd>{prompt.fingerprint}</dd>
                </dl>
                <div className="confirm-modal__actions">
                    <button type="button" className="action-key" onClick={() => onAnswer(false)} autoFocus>
                        Cancelar
                    </button>
                    <button type="button" className="action-key ssh-primary" onClick={() => onAnswer(true)}>
                        Confiar e conectar
                    </button>
                </div>
            </div>
        </div>
    );
}

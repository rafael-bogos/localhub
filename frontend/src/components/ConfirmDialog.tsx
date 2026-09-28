import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertIcon } from './icons';

interface PendingConfirm {
    message: string;
    resolve: (value: boolean) => void;
}

type ConfirmFn = (message: string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

// Wails uses WKWebView on macOS, which never implements window.confirm/alert —
// the call resolves immediately without showing anything, so every destructive
// action silently no-ops there. This in-app modal replaces window.confirm
// everywhere so confirmation works identically on Linux/Windows/macOS.
export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const confirm = useCallback<ConfirmFn>((message) => {
        return new Promise((resolve) => {
            setPending({ message, resolve });
        });
    }, []);

    function respond(value: boolean) {
        pending?.resolve(value);
        setPending(null);
    }

    useEffect(() => {
        if (!pending) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') respond(false);
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pending]);

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {pending && (
                <div className="confirm-overlay" onClick={() => respond(false)}>
                    <div
                        className="confirm-modal"
                        role="alertdialog"
                        aria-modal="true"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <p className="confirm-modal__message">
                            <AlertIcon size={16} />
                            {pending.message}
                        </p>
                        <div className="confirm-modal__actions">
                            <button className="action-key" onClick={() => respond(false)} autoFocus>
                                Cancelar
                            </button>
                            <button className="kill-key" onClick={() => respond(true)}>
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirm precisa estar dentro de um ConfirmProvider');
    }
    return ctx;
}

import type { ReactNode } from 'react';

interface BatchBarProps {
    count: number;
    /** "container(es)", "imagem(ns)"… shown after the count. */
    noun: string;
    onClear: () => void;
    children: ReactNode;
}

/** Appears above a table while rows are selected, holding the batch actions. */
function BatchBar({ count, noun, onClear, children }: BatchBarProps) {
    return (
        <div className="batch-bar" role="region" aria-label="Ações em lote">
            <span className="batch-bar__count">
                {count} {noun} selecionado(s)
            </span>
            <div className="batch-bar__actions">
                {children}
                <button className="action-key" onClick={onClear}>
                    Limpar seleção
                </button>
            </div>
        </div>
    );
}

export default BatchBar;

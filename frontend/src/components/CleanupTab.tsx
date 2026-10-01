import { useEffect, useState } from 'react';
import CleanupPanel from './CleanupPanel';
import NodeModulesCleaner from './NodeModulesCleaner';

type View = 'docker' | 'node';

interface CleanupTabProps {
    onCountChange: (count: number) => void;
}

// Both cleaners stay mounted (the inactive one is just hidden) so switching
// views never throws away a finished scan or a selection.
function CleanupTab({ onCountChange }: CleanupTabProps) {
    const [view, setView] = useState<View>('docker');
    const [counts, setCounts] = useState<Record<View, number>>({ docker: 0, node: 0 });

    // The header counter follows the view being shown.
    useEffect(() => {
        onCountChange(counts[view]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, counts]);

    return (
        <>
            <div className="subtabs" role="tablist" aria-label="Tipo de limpeza">
                <button
                    role="tab"
                    aria-selected={view === 'docker'}
                    className={`subtab${view === 'docker' ? ' subtab--active' : ''}`}
                    onClick={() => setView('docker')}
                >
                    Docker
                </button>
                <button
                    role="tab"
                    aria-selected={view === 'node'}
                    className={`subtab${view === 'node' ? ' subtab--active' : ''}`}
                    onClick={() => setView('node')}
                >
                    node_modules
                </button>
            </div>

            <div className="cleanup-view cleanup-view--docker" hidden={view !== 'docker'}>
                <CleanupPanel onCountChange={(n) => setCounts((c) => ({ ...c, docker: n }))} />
            </div>
            <div className="cleanup-view cleanup-view--node" hidden={view !== 'node'}>
                <NodeModulesCleaner onCountChange={(n) => setCounts((c) => ({ ...c, node: n }))} />
            </div>
        </>
    );
}

export default CleanupTab;

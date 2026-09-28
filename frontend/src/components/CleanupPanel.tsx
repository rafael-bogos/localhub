import { useEffect, useState } from 'react';
import { Cleanup } from '../../wailsjs/go/main/App';
import { docker } from '../../wailsjs/go/models';
import { AlertIcon, BroomIcon } from './icons';
import { useConfirm } from './ConfirmDialog';

type Category = 'containers' | 'images' | 'networks' | 'buildCache';

const CATEGORIES: { key: Category; label: string; description: string }[] = [
    {
        key: 'containers',
        label: 'Containers parados',
        description: 'Remove containers que não estão em execução.',
    },
    {
        key: 'images',
        label: 'Imagens não usadas',
        description: 'Remove toda imagem sem container usando, não só as sem tag.',
    },
    {
        key: 'networks',
        label: 'Redes não usadas',
        description: 'Remove redes sem nenhum container conectado.',
    },
    {
        key: 'buildCache',
        label: 'Cache de build',
        description: 'Remove cache de build do BuildKit não utilizado.',
    },
];

interface CleanupPanelProps {
    onCountChange: (count: number) => void;
}

function formatSpace(mb: number): string {
    if (mb < 1000) {
        return `${mb}MB`;
    }
    const gb = (mb / 1024).toFixed(1).replace(/\.0$/, '');
    return `${gb}GB`;
}

function CleanupPanel({ onCountChange }: CleanupPanelProps) {
    const confirm = useConfirm();
    const [selected, setSelected] = useState<Record<Category, boolean>>({
        containers: false,
        images: false,
        networks: false,
        buildCache: false,
    });
    const [running, setRunning] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<docker.CleanupResult | null>(null);

    const selectedCount = CATEGORIES.filter((c) => selected[c.key]).length;
    const allSelected = selectedCount === CATEGORIES.length;

    useEffect(() => {
        onCountChange(selectedCount);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCount]);

    function toggle(key: Category) {
        setResult(null);
        setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
    }

    function toggleAll() {
        setResult(null);
        const next = !allSelected;
        setSelected({ containers: next, images: next, networks: next, buildCache: next });
    }

    async function handleCleanup() {
        const labels = CATEGORIES.filter((c) => selected[c.key]).map((c) => c.label);
        const confirmed = await confirm(
            `Limpar agora: ${labels.join(', ')}? Essa ação não pode ser desfeita.`
        );
        if (!confirmed) return;

        setError('');
        setResult(null);
        setRunning(true);
        try {
            const opts = new docker.CleanupOptions(selected);
            const outcome = await Cleanup(opts);
            setResult(outcome);
        } catch (err) {
            setError(String(err));
        } finally {
            setRunning(false);
        }
    }

    return (
        <>
            {error && (
                <p className="alert" role="alert">
                    <AlertIcon size={15} />
                    {error}
                </p>
            )}

            <label className="cleanup-row cleanup-row--all">
                <input
                    type="checkbox"
                    className="cleanup-checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                />
                <span className="cleanup-row__text">
                    <span className="cleanup-row__label">Selecionar tudo</span>
                    <span className="cleanup-row__description">Marca as {CATEGORIES.length} categorias abaixo de uma vez.</span>
                </span>
            </label>

            <div className="cleanup-list">
                {CATEGORIES.map((category) => (
                    <label key={category.key} className="cleanup-row">
                        <input
                            type="checkbox"
                            className="cleanup-checkbox"
                            checked={selected[category.key]}
                            onChange={() => toggle(category.key)}
                        />
                        <span className="cleanup-row__text">
                            <span className="cleanup-row__label">{category.label}</span>
                            <span className="cleanup-row__description">{category.description}</span>
                        </span>
                    </label>
                ))}
            </div>

            <div className="row-actions" style={{ justifyContent: 'flex-start', marginTop: '14px' }}>
                <button className="action-key" disabled={running || selectedCount === 0} onClick={handleCleanup}>
                    <BroomIcon size={14} />
                    {running ? 'Limpando' : allSelected ? 'Limpar tudo' : 'Limpar selecionados'}
                </button>
                {result && (
                    <span className="prune-result">
                        {result.containersRemoved + result.imagesRemoved + result.networksRemoved + result.buildCacheRemoved === 0
                            ? 'Nada para limpar nas categorias selecionadas.'
                            : `${result.containersRemoved} container(es), ${result.imagesRemoved} imagem(ns), ${result.networksRemoved} rede(s) e ${result.buildCacheRemoved} item(ns) de cache removidos — ${formatSpace(result.spaceMB)} liberados.`}
                    </span>
                )}
            </div>
        </>
    );
}

export default CleanupPanel;

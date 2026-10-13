import { useState, useEffect, useRef } from 'react';
import { ListImages, PruneImages, RemoveImage } from '../../wailsjs/go/main/App';
import { docker } from '../../wailsjs/go/models';
import { AlertIcon, LayersIcon, SearchIcon } from './icons';
import { matchesSearch } from '../search';
import { useConfirm } from './ConfirmDialog';
import { useSelection, clickedControl } from '../useSelection';
import { runBatch } from '../batch';
import RowCheck from './RowCheck';
import BatchBar from './BatchBar';

const COOL_DOWN_MS = 340;

function imageLabel(img: docker.ImageInfo): string {
    return img.repository === '<none>' ? img.id : `${img.repository}:${img.tag}`;
}

interface ImagesTableProps {
    /** The header search box: matches repository, tag and ID. */
    query: string;
    onCountChange: (count: number) => void;
}

function ImagesTable({ query, onCountChange }: ImagesTableProps) {
    const confirm = useConfirm();
    const [images, setImages] = useState<docker.ImageInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [coolingId, setCoolingId] = useState<string | null>(null);
    const [pruning, setPruning] = useState(false);
    const [pruneMessage, setPruneMessage] = useState('');
    const countReported = useRef(false);
    const selection = useSelection<string>();
    const [batchBusy, setBatchBusy] = useState(false);

    async function load() {
        setLoading(true);
        setError('');
        try {
            const result = await ListImages();
            setImages(result);
            onCountChange(result.length);
            countReported.current = true;
        } catch (err) {
            setError(String(err));
            if (!countReported.current) {
                onCountChange(0);
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleRemove(img: docker.ImageInfo) {
        const confirmed = await confirm(`Remover a imagem "${imageLabel(img)}"? Essa ação não pode ser desfeita.`);
        if (!confirmed) return;

        setError('');
        setPruneMessage('');
        setRemovingId(img.id);
        try {
            await RemoveImage(img.id);
            setCoolingId(img.id);
            await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            setRemovingId(null);
            setCoolingId(null);
        }
    }

    async function handlePrune() {
        const confirmed = await confirm('Remover todas as imagens não usadas (dangling)? Essa ação não pode ser desfeita.');
        if (!confirmed) return;

        setError('');
        setPruneMessage('');
        setPruning(true);
        try {
            const result = await PruneImages();
            setPruneMessage(
                result.count > 0
                    ? `${result.count} imagem(ns) removida(s), ${result.spaceMB}MB liberados.`
                    : 'Nenhuma imagem não usada encontrada.'
            );
            await load();
        } catch (err) {
            setError(String(err));
        } finally {
            setPruning(false);
        }
    }

    async function handleRemoveMany(targets: docker.ImageInfo[]) {
        const confirmed = await confirm(`Remover ${targets.length} imagem(ns)? Essa ação não pode ser desfeita.`);
        if (!confirmed) return;

        setError('');
        setPruneMessage('');
        setBatchBusy(true);
        try {
            const failures = await runBatch(targets, (img) => RemoveImage(img.id), imageLabel);
            selection.clear();
            await load();
            if (failures) setError(failures);
        } finally {
            setBatchBusy(false);
        }
    }

    const visible = images.filter((img) =>
        matchesSearch(query, img.repository, img.tag, `${img.repository}:${img.tag}`, img.id)
    );

    const picked = images.filter((img) => selection.selected.has(img.id));
    const visibleIds = visible.map((img) => img.id);
    const allVisiblePicked = visibleIds.length > 0 && visibleIds.every((id) => selection.selected.has(id));
    const someVisiblePicked = visibleIds.some((id) => selection.selected.has(id));

    if (!loading && images.length === 0 && !error) {
        return (
            <div className="empty-state">
                <LayersIcon />
                <p>Nenhuma imagem encontrada.</p>
            </div>
        );
    }

    return (
        <>
            {error && (
                <p className="alert" role="alert">
                    <AlertIcon size={15} />
                    {error}
                </p>
            )}

            {images.length > 0 && (
                <>
                    <div className="row-actions" style={{ marginBottom: '10px' }}>
                        <button className="action-key" disabled={pruning} onClick={handlePrune}>
                            {pruning ? 'Limpando' : 'Limpar não usadas'}
                        </button>
                        {pruneMessage && <span className="prune-result">{pruneMessage}</span>}
                    </div>

                    {picked.length > 0 && (
                        <BatchBar count={picked.length} noun="imagem(ns)" onClear={selection.clear}>
                            <button className="kill-key" disabled={batchBusy} onClick={() => handleRemoveMany(picked)}>
                                {batchBusy ? 'Removendo' : `Remover (${picked.length})`}
                            </button>
                        </BatchBar>
                    )}

                    {visible.length === 0 && (
                        <div className="empty-state">
                            <SearchIcon size={32} />
                            <p>Nenhuma imagem encontrada para "{query.trim()}".</p>
                        </div>
                    )}

                    {visible.length > 0 && (
                    <table className="images-table">
                        <thead>
                            <tr>
                                <th>
                                    <RowCheck
                                        checked={allVisiblePicked}
                                        indeterminate={someVisiblePicked}
                                        label="Selecionar todas as imagens listadas"
                                        onChange={() => selection.setMany(visibleIds, !allVisiblePicked)}
                                    />
                                    Repositório
                                </th>
                                <th>Tag</th>
                                <th>ID</th>
                                <th>Tamanho</th>
                                <th>Criada em</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((img) => {
                                const isRemoving = removingId === img.id;
                                const isCooling = coolingId === img.id;

                                return (
                                    <tr
                                        key={img.id}
                                        className={[
                                            'image-row',
                                            isCooling ? 'image-row--cooling' : '',
                                            'row--selectable',
                                            selection.selected.has(img.id) ? 'row--selected' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                        onClick={(e) => {
                                            if (!clickedControl(e)) selection.toggle(img.id);
                                        }}
                                    >
                                        <td className="image-row__repo">
                                            <RowCheck
                                                checked={selection.selected.has(img.id)}
                                                label={`Selecionar ${imageLabel(img)}`}
                                                onChange={() => selection.toggle(img.id)}
                                            />
                                            {img.repository}
                                        </td>
                                        <td className="image-row__tag">{img.tag}</td>
                                        <td className="image-row__id" data-label="ID">{img.id}</td>
                                        <td className="image-row__size" data-label="Tamanho">{img.size}</td>
                                        <td className="image-row__created" data-label="Criada em">{img.created}</td>
                                        <td>
                                            <div className="row-actions">
                                                <button
                                                    className="kill-key"
                                                    disabled={isRemoving}
                                                    onClick={() => handleRemove(img)}
                                                >
                                                    {isRemoving ? 'Removendo' : 'Remover'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    )}
                </>
            )}
        </>
    );
}

export default ImagesTable;

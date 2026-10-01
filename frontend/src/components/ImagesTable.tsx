import { useState, useEffect, useRef } from 'react';
import { ListImages, PruneImages, RemoveImage } from '../../wailsjs/go/main/App';
import { docker } from '../../wailsjs/go/models';
import { AlertIcon, LayersIcon } from './icons';
import { useConfirm } from './ConfirmDialog';

const COOL_DOWN_MS = 340;

interface ImagesTableProps {
    onCountChange: (count: number) => void;
}

function ImagesTable({ onCountChange }: ImagesTableProps) {
    const confirm = useConfirm();
    const [images, setImages] = useState<docker.ImageInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [coolingId, setCoolingId] = useState<string | null>(null);
    const [pruning, setPruning] = useState(false);
    const [pruneMessage, setPruneMessage] = useState('');
    const countReported = useRef(false);

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
        const label = img.repository === '<none>' ? img.id : `${img.repository}:${img.tag}`;
        const confirmed = await confirm(`Remover a imagem "${label}"? Essa ação não pode ser desfeita.`);
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

                    <table className="images-table">
                        <thead>
                            <tr>
                                <th>Repositório</th>
                                <th>Tag</th>
                                <th>ID</th>
                                <th>Tamanho</th>
                                <th>Criada em</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {images.map((img) => {
                                const isRemoving = removingId === img.id;
                                const isCooling = coolingId === img.id;

                                return (
                                    <tr
                                        key={img.id}
                                        className={['image-row', isCooling ? 'image-row--cooling' : '']
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <td className="image-row__repo">{img.repository}</td>
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
                </>
            )}
        </>
    );
}

export default ImagesTable;

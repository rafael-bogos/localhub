import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteListImages, RemoteRemoveImage } from '../../wailsjs/go/main/App';
import { docker, ssh } from '../../wailsjs/go/models';
import { AlertIcon } from './icons';
import { GroupNote } from './HostGroup';
import { useConfirm } from './ConfirmDialog';

const COOL_DOWN_MS = 340;

interface RemoteImagesSectionProps {
    hostId: string;
    hostName: string;
    refreshKey: number;
    onCount: (n: number) => void;
}

/** Docker images of one connected server. */
function RemoteImagesSection({ hostId, hostName, refreshKey, onCount }: RemoteImagesSectionProps) {
    const confirm = useConfirm();
    const [result, setResult] = useState<ssh.RemoteImages | null>(null);
    const [error, setError] = useState('');
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [coolingId, setCoolingId] = useState<string | null>(null);
    const countRef = useRef(onCount);
    countRef.current = onCount;

    const load = useCallback(async () => {
        setError('');
        try {
            const r = await RemoteListImages(hostId);
            setResult(r);
            countRef.current(r.status === 'ok' ? (r.items ?? []).length : 0);
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
            countRef.current(0);
        }
    }, [hostId]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    async function handleRemove(img: docker.ImageInfo) {
        const label = img.repository === '<none>' ? img.id : `${img.repository}:${img.tag}`;
        if (!(await confirm(`Remover a imagem "${label}" em "${hostName}"? Essa ação não pode ser desfeita.`))) return;
        setError('');
        setRemovingId(img.id);
        try {
            await RemoteRemoveImage(hostId, img.id);
            setCoolingId(img.id);
            await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS));
            await load();
        } catch (err) {
            setError(String(err).replace(/^Error:\s*/, ''));
        } finally {
            setRemovingId(null);
            setCoolingId(null);
        }
    }

    const items = result?.items ?? [];

    return (
        <>
            {error && (
                <p className="alert" role="alert">
                    <AlertIcon size={15} />
                    {error}
                </p>
            )}
            {!result && !error && <GroupNote>Carregando…</GroupNote>}
            {result && result.status !== 'ok' && <GroupNote tone="warn">{result.message}</GroupNote>}
            {result?.status === 'ok' && items.length === 0 && <GroupNote>Nenhuma imagem neste servidor.</GroupNote>}
            {result?.status === 'ok' && items.length > 0 && (
                <table className="remote-table remote-table--images">
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
                        {items.map((img) => (
                            <tr
                                key={img.id}
                                className={['image-row', coolingId === img.id ? 'image-row--cooling' : '']
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                <td className="image-row__repo">{img.repository}</td>
                                <td className="image-row__tag" data-label="Tag">
                                    {img.tag}
                                </td>
                                <td className="image-row__id" data-label="ID">
                                    {img.id}
                                </td>
                                <td className="image-row__size" data-label="Tamanho">
                                    {img.size}
                                </td>
                                <td className="image-row__created" data-label="Criada em">
                                    {img.created}
                                </td>
                                <td>
                                    <div className="row-actions">
                                        <button
                                            className="kill-key"
                                            disabled={removingId === img.id}
                                            onClick={() => handleRemove(img)}
                                        >
                                            {removingId === img.id ? 'Removendo' : 'Remover'}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </>
    );
}

export default RemoteImagesSection;

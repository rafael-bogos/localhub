import { useEffect, useRef, useState } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';

/** What the backend knows about a Compose container (docker.RebuildInfo). */
export interface RebuildInfo {
    /** The service builds its image: there is something to rebuild. */
    build: boolean;
    /** Why the project could not be read; shown as the disabled button's tooltip. */
    problem: string;
    /** The deploy platform that manages the container ("Coolify"...). */
    platform: string;
    /** localhub can ask the platform for a redeploy (Coolify). */
    redeploy: boolean;
}

interface RebuildEvent {
    hostId: string;
    containerId: string;
    phase: 'start' | 'build' | 'recreate' | 'deploy';
    step: number;
    total: number;
    text: string;
}

interface RebuildStatusProps {
    /** "" is this machine. */
    hostId: string;
    containerId: string;
}

// A long build would make a row of 40 blocks; past this the stack is scaled down.
const MAX_BLOCKS = 12;

function clock(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Shown on a container's row while its image is rebuilt. An image is a stack
 * of layers, so the build is drawn as one: a block per Dockerfile step that
 * fills as the step finishes, the running one pulsing, then the whole stack
 * settling while the container is swapped. Below it, the instruction being
 * run and a stopwatch. Mounted only while the rebuild runs.
 */
function RebuildStatus({ hostId, containerId }: RebuildStatusProps) {
    const [ev, setEv] = useState<RebuildEvent | null>(null);
    const [seconds, setSeconds] = useState(0);
    // The stack keeps its size when the build ends and the container is swapped.
    const lastTotal = useRef(0);

    useEffect(() => {
        return EventsOn('container:rebuild', (raw: RebuildEvent) => {
            if (raw.hostId === hostId && raw.containerId === containerId) setEv(raw);
        });
    }, [hostId, containerId]);

    useEffect(() => {
        const t = setInterval(() => setSeconds((s) => s + 1), 1000);
        return () => clearInterval(t);
    }, []);

    const phase = ev?.phase ?? 'start';
    if (ev && ev.total > 0) lastTotal.current = ev.total;
    // A Coolify deploy has no steps to count: the stack waves while it runs.
    const known = (phase === 'build' || phase === 'recreate') && lastTotal.current > 0;
    const total = known ? Math.min(lastTotal.current, MAX_BLOCKS) : 6;
    // Scale the step to the blocks drawn when the build has more steps than blocks.
    const step = known && ev && ev.total > 0 ? Math.min(total, Math.max(1, Math.ceil((ev.step / ev.total) * total))) : 0;
    const recreating = phase === 'recreate';

    const label =
        phase === 'recreate'
            ? 'Trocando o container pelo novo…'
            : phase === 'build' && ev
              ? `Passo ${ev.step}/${ev.total} · ${ev.text}`
              : phase === 'deploy'
                ? `Deploy no Coolify · ${ev?.text || 'iniciando'}`
                : 'Lendo o projeto…';

    return (
        <span
            className={`rebuild${known ? '' : ' rebuild--indeterminate'}${recreating ? ' rebuild--recreate' : ''}`}
            role="status"
            aria-live="polite"
            aria-label={`${phase === 'deploy' ? 'Fazendo deploy' : 'Reconstruindo'}. ${label}`}
        >
            <span className="rebuild__stack" aria-hidden="true">
                {Array.from({ length: total }, (_, i) => {
                    const n = i + 1;
                    const state = recreating || (known && n < step) ? 'done' : known && n === step ? 'active' : 'todo';
                    return <span key={i} className={`rebuild__layer rebuild__layer--${state}`} style={{ ['--i' as string]: i }} />;
                })}
            </span>
            <span className="rebuild__line">
                <span className="rebuild__text" title={label}>
                    {label}
                </span>
                <span className="rebuild__clock">{clock(seconds)}</span>
            </span>
        </span>
    );
}

export default RebuildStatus;

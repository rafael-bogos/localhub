import { useCallback, useState } from 'react';

// Platforms that give containers generated names (Coolify, Dokku...) keep the
// readable name of an app in a label. Which label differs per platform, so the
// user picks it once from a container's labels and it applies to every
// container that has it.
const STORAGE_KEY = 'localhub.names.v1';

/** Labels worth offering first: where common platforms keep an app's name. */
export const KNOWN_NAME_LABELS = [
    'coolify.name',
    'coolify.projectName',
    'com.dokku.app-name',
    'com.docker.compose.service',
    'com.docker.compose.project',
    'com.docker.stack.namespace',
    'com.docker.swarm.service.name',
];

interface Named {
    name: string;
    labels?: Record<string, string> | null;
}

/** The name to show for a container: the chosen label's value when it has one, else its Docker name. */
export function displayName(c: Named, nameLabel: string): string {
    const v = nameLabel ? c.labels?.[nameLabel]?.trim() : '';
    return v || c.name;
}

/** True when the shown name comes from the label rather than the Docker name. */
export function isCustomName(c: Named, nameLabel: string): boolean {
    return displayName(c, nameLabel) !== c.name;
}

function load(): string {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        return raw && typeof raw.label === 'string' ? raw.label.slice(0, 200) : '';
    } catch {
        return '';
    }
}

export interface NameLabelApi {
    /** The label used as display name; empty means "use the Docker name". */
    nameLabel: string;
    setNameLabel: (label: string) => void;
}

export function useNameLabel(): NameLabelApi {
    const [nameLabel, setState] = useState(load);
    const setNameLabel = useCallback((label: string) => {
        setState(label);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ label }));
        } catch {
            // Storage unavailable: the choice just won't persist.
        }
    }, []);
    return { nameLabel, setNameLabel };
}

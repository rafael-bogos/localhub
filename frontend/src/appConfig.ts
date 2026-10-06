import { LoadConfig, SaveConfig } from '../wailsjs/go/main/App';

// The user's settings (saved servers, tunnels, display names, preferences) live
// in a file the backend keeps in the system's config directory, not in the
// webview's localStorage: that one is tied to the binary's name and the dev
// server's port, so an update or a different build would start from empty.
//
// The file is read once, before the interface is drawn, so every hook can
// start from its saved value synchronously; writes go to the file as they happen.
//
// Safety rule: until the file has been read successfully, nothing is written. Hooks save
// their state when they mount, and writing an empty "I found nothing" over the
// user's real settings after a failed read would destroy them.

const LOAD_ATTEMPTS = 8;
const LOAD_RETRY_MS = 350;
const LOAD_TIMEOUT_MS = 3000;

interface ConfigState {
    cache: Record<string, unknown>;
    /** A read succeeded: only then may anything be written. */
    loaded: boolean;
    problem: string;
}

// Kept on the window, not in module variables: if this module is re-evaluated
// while the page lives on (hot reload in `wails dev`), a module-level cache
// would silently reset to empty and the hooks would then save "nothing" over
// the user's settings. A fresh state starts unloaded, so nothing is written
// until a read has really succeeded.
const state: ConfigState = ((globalThis as { __localhubConfig?: ConfigState }).__localhubConfig ??= {
    cache: {},
    loaded: false,
    problem: '',
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('tempo esgotado ao ler a configuração')), ms);
        p.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            }
        );
    });
}

/**
 * Reads the settings file. Call it (and wait) before rendering the app. A read
 * that fails is retried (the backend may still be starting); if it keeps
 * failing, writes are disabled and configProblem() says why.
 */
export async function loadAppConfig(): Promise<void> {
    let last: unknown;
    for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt++) {
        try {
            state.cache = (await withTimeout(LoadConfig(), LOAD_TIMEOUT_MS)) ?? {};
            state.loaded = true;
            state.problem = '';
            return;
        } catch (err) {
            last = err;
            await sleep(LOAD_RETRY_MS);
        }
    }
    state.cache = {};
    state.loaded = false;
    state.problem = String(last).replace(/^Error:\s*/, '');
    console.error('não foi possível ler a configuração; as alterações não serão salvas:', last);
}

/** Why the settings could not be read (and so are not being saved); empty when all is well. */
export function configProblem(): string {
    return state.problem;
}

/** The saved value of a setting (already parsed JSON), or undefined. */
export function readConfig(key: string): unknown {
    return state.cache[key];
}

/** Saves a setting to the file. Failures are logged, never thrown into the UI. */
export function writeConfig(key: string, value: unknown): void {
    if (!state.loaded) return;
    // Nothing to write when the value is what the file already holds.
    if (JSON.stringify(state.cache[key]) === JSON.stringify(value)) return;
    state.cache[key] = value;
    SaveConfig(key, JSON.stringify(value)).catch((err) => {
        console.error(`não foi possível salvar a configuração "${key}":`, err);
    });
}

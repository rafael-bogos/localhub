import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { SSHCloseTerminal, SSHOpenTerminal, SSHResize, SSHWrite } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import type { SshHost } from '../useSshHosts';

interface SshTerminalProps {
    host: SshHost;
    /** The SSH tab is the visible one; the terminal is refitted when it becomes visible. */
    visible: boolean;
    onEnded: (reason: string, message: string) => void;
}

interface EndEvent {
    reason: string;
    message: string;
}

const OPEN_RETRIES = 10;
const OPEN_RETRY_MS = 100;

function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

/**
 * The interactive shell of one connected server. It owns the remote terminal:
 * mounting opens it, unmounting closes it (the connection stays up).
 */
function SshTerminal({ host, visible, onEnded }: SshTerminalProps) {
    const boxRef = useRef<HTMLDivElement>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const endedRef = useRef(onEnded);
    endedRef.current = onEnded;

    useEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const id = host.id;
        // Events are keyed by this session (not the server), so a late event of a
        // previous terminal can never reach this one.
        const session = crypto.randomUUID();
        let cancelled = false;

        const term = new Terminal({
            fontFamily: cssVar('--font-mono', 'monospace'),
            fontSize: 13,
            lineHeight: 1.25,
            cursorBlink: true,
            scrollback: 5000,
            theme: {
                background: cssVar('--chassis-bg', '#14161a'),
                foreground: cssVar('--ink-primary', '#e9e6df'),
                cursor: cssVar('--amber', '#ffb238'),
                cursorAccent: cssVar('--chassis-bg', '#14161a'),
                selectionBackground: 'rgba(255, 178, 56, 0.28)',
                black: '#21252b',
                red: '#e5736b',
                green: '#9bbf8a',
                yellow: '#d9b86c',
                blue: '#7fa3c7',
                magenta: '#b595c4',
                cyan: '#7fbdb8',
                white: '#c9c6bf',
                brightBlack: '#5b5e5a',
                brightRed: '#ef8f87',
                brightGreen: '#b3d4a3',
                brightYellow: '#ebcf8a',
                brightBlue: '#9ab9d6',
                brightMagenta: '#c9aed6',
                brightCyan: '#97d0cb',
                brightWhite: '#e9e6df',
            },
        });
        const fit = new FitAddon();
        fitRef.current = fit;
        term.loadAddon(fit);
        term.open(box);

        const refit = () => {
            // A hidden tab has no size; fitting then would shrink the PTY to 0.
            if (box.offsetWidth > 0 && box.offsetHeight > 0) fit.fit();
        };
        refit();
        // Cell size depends on the web font; remeasure once it is loaded.
        document.fonts?.load('13px "IBM Plex Mono"').then(() => !cancelled && refit()).catch(() => {});

        // Subscribe before opening so no early output is lost.
        const offData = EventsOn(`ssh:data:${session}`, (b64: string) => term.write(decodeBase64(b64)));
        const offEnd = EventsOn(`ssh:end:${session}`, (ev: EndEvent) => {
            const text =
                ev.reason === 'disconnected'
                    ? 'conexão encerrada'
                    : ev.reason === 'error'
                      ? `erro: ${ev.message}`
                      : 'sessão encerrada';
            term.write(`\r\n\x1b[2m[${text}]\x1b[0m\r\n`);
            endedRef.current(ev.reason, ev.message ?? '');
        });

        const onData = term.onData((d) => {
            SSHWrite(id, d).catch(() => {});
        });
        const onResize = term.onResize(({ cols, rows }) => {
            SSHResize(id, cols, rows).catch(() => {});
        });

        // The previous terminal (if any) is released asynchronously by the
        // backend, so "já existe um terminal aberto" is retried briefly.
        (async () => {
            for (let attempt = 0; attempt < OPEN_RETRIES; attempt++) {
                if (cancelled) return;
                try {
                    await SSHOpenTerminal(id, session, term.cols, term.rows);
                    if (cancelled) SSHCloseTerminal(id, session).catch(() => {});
                    else term.focus();
                    return;
                } catch (err) {
                    const msg = String(err);
                    if (!msg.includes('já existe') || attempt === OPEN_RETRIES - 1) {
                        if (!cancelled) {
                            term.write(`\x1b[2m[erro: ${msg.replace(/^Error:\s*/, '')}]\x1b[0m\r\n`);
                            endedRef.current('error', msg);
                        }
                        return;
                    }
                    await new Promise((r) => setTimeout(r, OPEN_RETRY_MS));
                }
            }
        })();

        const observer = new ResizeObserver(refit);
        observer.observe(box);

        // Keys typed in the terminal belong to the remote shell: keep them from
        // reaching window-level shortcuts (Esc closes the logs drawer).
        const stopKeys = (e: KeyboardEvent) => e.stopPropagation();
        box.addEventListener('keydown', stopKeys);

        return () => {
            cancelled = true;
            box.removeEventListener('keydown', stopKeys);
            observer.disconnect();
            onData.dispose();
            onResize.dispose();
            offData();
            offEnd();
            SSHCloseTerminal(id, session).catch(() => {});
            fitRef.current = null;
            term.dispose();
        };
    }, [host.id]);

    useEffect(() => {
        if (visible) fitRef.current?.fit();
    }, [visible]);

    return <div className="ssh-terminal" ref={boxRef} />;
}

export default SshTerminal;

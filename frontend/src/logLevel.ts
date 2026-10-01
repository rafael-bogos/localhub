// Level detection for container log lines. Docker delivers plain text with no
// level field, so the level is inferred from the line's format. Every rule
// lives in the RULES table below — refining detection means adding or
// adjusting a row, never touching the logic.

export type Level = 'erro' | 'aviso' | 'info' | 'debug' | 'outros';

export const LEVELS: Level[] = ['erro', 'aviso', 'info', 'debug', 'outros'];

const NAMES: Record<string, Level> = {
    fatal: 'erro',
    panic: 'erro',
    emerg: 'erro',
    emergency: 'erro',
    alert: 'erro',
    crit: 'erro',
    critical: 'erro',
    severe: 'erro',
    error: 'erro',
    err: 'erro',
    warn: 'aviso',
    warning: 'aviso',
    info: 'info',
    notice: 'info',
    note: 'info',
    system: 'info',
    log: 'info',
    debug: 'debug',
    trace: 'debug',
    verbose: 'debug',
};

function fromName(name: string): Level | null {
    return NAMES[name.toLowerCase()] ?? null;
}

// pino's numeric levels: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.
function fromPinoNumber(n: number): Level | null {
    if (n >= 50) return 'erro';
    if (n >= 40) return 'aviso';
    if (n >= 30) return 'info';
    if (n >= 10) return 'debug';
    return null;
}

const WORDS = 'fatal|panic|emerg|emergency|alert|crit|critical|severe|error|err|warn|warning|info|notice|note|system|log|debug|trace|verbose';

interface Rule {
    name: string;
    detect: (text: string) => Level | null;
}

// First rule that matches wins, in this order.
const RULES: Rule[] = [
    {
        // {"level":"error"}, {"severity":"WARNING"}, pino {"level":50}
        name: 'json',
        detect: (text) => {
            if (text[0] !== '{') return null;
            const m = /"(?:level|severity|lvl)"\s*:\s*"?([A-Za-z]+|\d+)"?/i.exec(text);
            if (!m) return null;
            return /^\d+$/.test(m[1]) ? fromPinoNumber(Number(m[1])) : fromName(m[1]);
        },
    },
    {
        // level=error msg="..."
        name: 'logfmt',
        detect: (text) => {
            const m = /(?:^|\s)(?:level|lvl|severity)=("?)([A-Za-z]+)\1/i.exec(text);
            return m ? fromName(m[2]) : null;
        },
    },
    {
        // MariaDB/MySQL "[Warning]", nginx "[error]" — near the start of the line.
        name: 'brackets',
        detect: (text) => {
            const m = new RegExp(`\\[(${WORDS})\\]`, 'i').exec(text.slice(0, 60));
            return m ? fromName(m[1]) : null;
        },
    },
    {
        // Monolog/Laravel "production.ERROR: ..."
        name: 'monolog',
        detect: (text) => {
            const m = /(?:^|\s)[A-Za-z][\w-]*\.(EMERGENCY|ALERT|CRITICAL|ERROR|WARNING|NOTICE|INFO|DEBUG):/.exec(
                text.slice(0, 80)
            );
            return m ? fromName(m[1]) : null;
        },
    },
    {
        // Redis "1:M 29 Sep 2026 12:00:00.123 * Ready" — a symbol after the time.
        name: 'redis',
        detect: (text) => {
            const m = /^\d+:[XCSM]\s+\d{1,2}\s+\w{3}\s+(?:\d{4}\s+)?[\d:.]+\s+([.\-*#])\s/.exec(text);
            if (!m) return null;
            if (m[1] === '#') return 'aviso';
            if (m[1] === '*') return 'info';
            return 'debug';
        },
    },
    {
        // "2026-09-29 ERROR falha" — UPPERCASE and standalone, near the start,
        // so "no error found" mid-sentence is never flagged.
        name: 'word',
        detect: (text) => {
            const m = /(?:^|[\s:[(|])(FATAL|PANIC|CRITICAL|ERROR|ERR|WARNING|WARN|INFO|NOTICE|DEBUG|TRACE)(?=$|[\s:\])|,])/.exec(
                text.slice(0, 80)
            );
            return m ? fromName(m[1]) : null;
        },
    },
    {
        // "Error: boom", "TypeError: x", "java.lang.RuntimeException: x",
        // "panic: x", "Traceback (most recent call last):" — how exceptions
        // start, whatever the capitalization. Only at the very start of a line.
        name: 'exception',
        detect: (text) =>
            /^(?:[\w.$]*(?:Error|Exception)\b|panic:|Traceback \(most recent call last\)|Unhandled)/.test(text)
                ? 'erro'
                : null,
    },
];

// Stack-trace continuation lines: indented, "at ...", "Caused by:", "...".
const CONTINUATION = /^(\s+|at\s|Caused by:|\.\.\.|Traceback)/;

export function detectLevel(text: string): Level {
    for (const rule of RULES) {
        const level = rule.detect(text);
        if (level) return level;
    }
    return 'outros';
}

export type StreamName = 'stdout' | 'stderr';

/** Last level seen per stream, so continuation lines can inherit it. */
export type LevelMemory = Record<StreamName, Level>;

export function newLevelMemory(): LevelMemory {
    return { stdout: 'outros', stderr: 'outros' };
}

/**
 * Level of one line given the previous line of the same stream: an
 * unrecognized continuation line (stack trace) inherits the previous level, so
 * a level filter never separates an error from its stack.
 */
export function levelFor(text: string, stream: StreamName, memory: LevelMemory): Level {
    let level = detectLevel(text);
    if (level === 'outros' && CONTINUATION.test(text)) {
        level = memory[stream];
    }
    memory[stream] = level;
    return level;
}

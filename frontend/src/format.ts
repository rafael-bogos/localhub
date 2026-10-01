const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units (1 KiB = 1024 B), like `docker stats` and `du -h`. */
export function formatBytes(bytes: number): string {
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

export function formatPercent(value: number): string {
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

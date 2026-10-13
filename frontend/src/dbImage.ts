/**
 * Whether an image looks like a PostgreSQL or MySQL/MariaDB server, to offer
 * "Acessar banco" on its container. Only a hint for the button: the backend
 * (orm.KindFromImage) makes the real decision when it is clicked.
 */
export function looksLikeDbImage(image: string): boolean {
    let repo = image.split('@')[0];
    const colon = repo.lastIndexOf(':');
    if (colon > repo.lastIndexOf('/')) repo = repo.slice(0, colon);
    const base = repo.slice(repo.lastIndexOf('/') + 1).toLowerCase();
    return (
        base.includes('postgres') ||
        base.includes('mysql') ||
        base.includes('mariadb') ||
        ['postgis', 'timescaledb', 'supabase', 'percona'].includes(base)
    );
}

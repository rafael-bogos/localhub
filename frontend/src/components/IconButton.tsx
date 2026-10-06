import type { ReactNode } from 'react';

interface IconButtonProps {
    icon: ReactNode;
    /** What the button does: its accessible name and, by default, its tooltip. */
    label: string;
    /** Tooltip when it should say more than the label. */
    title?: string;
    onClick?: () => void;
    disabled?: boolean;
    /** The destructive role (the orange key). */
    danger?: boolean;
    /** Toggle state, for a button that opens/closes a panel. */
    pressed?: boolean;
    /** The action is running. */
    busy?: boolean;
}

/** An action key that shows only an icon; the label is its tooltip and accessible name. */
function IconButton({ icon, label, title, onClick, disabled, danger, pressed, busy }: IconButtonProps) {
    return (
        <button
            type="button"
            className={`${danger ? 'kill-key' : 'action-key'} icon-key${busy ? ' icon-key--busy' : ''}`}
            aria-label={label}
            title={title ?? label}
            aria-pressed={pressed}
            aria-busy={busy || undefined}
            disabled={disabled}
            onClick={onClick}
        >
            {icon}
        </button>
    );
}

export default IconButton;

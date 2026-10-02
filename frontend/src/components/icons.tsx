interface IconProps {
    size?: number;
    className?: string;
}

const STROKE = 1.75;

export function RefreshIcon({ size = 16, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M3.5 12a8.5 8.5 0 0 1 14.5-6" />
            <path d="M20.5 12a8.5 8.5 0 0 1-14.5 6" />
            <path d="M18 6.5V3.5h-3" />
            <path d="M6 17.5v3h3" />
        </svg>
    );
}

export function UnplugIcon({ size = 32, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M11 4v6" />
            <path d="M17 4v6" />
            <path d="M8 10h12v4a6 6 0 0 1-12 0v-4z" />
            <path d="M14 20v4" />
            <path d="M8 28h12" />
        </svg>
    );
}

export function BoxIcon({ size = 32, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M16 4 27 9.5v13L16 28 5 22.5v-13L16 4z" />
            <path d="M5 9.5 16 15l11-5.5" />
            <path d="M16 15v13" />
        </svg>
    );
}

export function LayersIcon({ size = 32, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M16 5 27 11 16 17 5 11 16 5z" />
            <path d="M5 16 16 22 27 16" />
            <path d="M5 21 16 27 27 21" />
        </svg>
    );
}

export function SearchIcon({ size = 16, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m20 20-4.8-4.8" />
        </svg>
    );
}

export function CloseIcon({ size = 12, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M5 5 19 19" />
            <path d="M19 5 5 19" />
        </svg>
    );
}

export function BroomIcon({ size = 16, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M20 4 11 13" />
            <path d="M11 13 4 20" />
            <path d="M11 13 6.5 17.5" />
            <path d="M13.5 15.5 9 20" />
            <path d="M9 20h5.5" />
        </svg>
    );
}

export function ChevronIcon({ size = 14, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="m9 6 6 6-6 6" />
        </svg>
    );
}

export function AlertIcon({ size = 16, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M12 3.5 22 20.5H2L12 3.5z" />
            <path d="M12 10v4.5" />
            <path d="M12 17.8h0" />
        </svg>
    );
}

export function ExpandIcon({ size = 14, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
        </svg>
    );
}

export function ShrinkIcon({ size = 14, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M14 10l7-7" />
            <path d="M3 21l7-7" />
            <path d="M20 10h-6V4" />
            <path d="M4 14h6v6" />
        </svg>
    );
}

export function FolderIcon({ size = 14, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
    );
}

export function ServerIcon({ size = 32, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <rect x="4" y="6" width="24" height="8" rx="2" />
            <rect x="4" y="18" width="24" height="8" rx="2" />
            <path d="M9 10h.01M9 22h.01" />
            <path d="M14 10h9M14 22h9" />
        </svg>
    );
}

export function InfoIcon({ size = 14, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
        </svg>
    );
}

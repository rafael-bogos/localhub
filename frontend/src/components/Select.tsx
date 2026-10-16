import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronIcon } from './icons';

export interface SelectOption {
    value: string;
    label: string;
    /** Smaller text after the label (an IP, a hint). */
    detail?: string;
}

interface SelectProps {
    value: string;
    options: SelectOption[];
    onChange: (value: string) => void;
    ariaLabel?: string;
    disabled?: boolean;
    /** Extra class for the button; `select--mono` / `select--active` are modifiers. */
    className?: string;
    /** Highlight the button, like a filter that is on. */
    active?: boolean;
    /** Open to the right edge of the button instead of the left. */
    align?: 'start' | 'end';
}

interface Pos {
    left: number;
    top?: number;
    bottom?: number;
    minWidth: number;
    maxHeight: number;
}

const MENU_GAP = 4;
const MENU_MAX = 280;

/**
 * Replaces the native <select>, whose option list the OS draws (white, outside
 * the theme). Same behavior: keyboard (arrows, Home/End, type-ahead, Enter,
 * Esc), closes on outside click, and the list is drawn in a portal so dialogs
 * and scroll areas never clip it.
 */
export function Select({ value, options, onChange, ariaLabel, disabled, className, active, align = 'start' }: SelectProps) {
    const id = useId();
    const button = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLUListElement>(null);
    const typed = useRef({ text: '', at: 0 });
    const [cursor, setCursor] = useState(0);
    // The list exists only with its position: it is placed before it is first
    // drawn and never reused from the last time, so it cannot flash in the wrong spot.
    const [pos, setPos] = useState<Pos | null>(null);
    const open = pos !== null;

    const selected = options.findIndex((o) => o.value === value);
    const current = options[selected];

    const close = useCallback((refocus: boolean) => {
        setPos(null);
        if (refocus) button.current?.focus();
    }, []);

    function openMenu() {
        if (disabled || options.length === 0 || !button.current) return;
        const r = button.current.getBoundingClientRect();
        const below = window.innerHeight - r.bottom - MENU_GAP - 8;
        const above = r.top - MENU_GAP - 8;
        const flip = below < 160 && above > below;
        setCursor(Math.max(0, selected));
        setPos({
            left: align === 'end' ? Math.max(8, r.right) : r.left,
            minWidth: r.width,
            maxHeight: Math.max(120, Math.min(MENU_MAX, flip ? above : below)),
            ...(flip ? { bottom: window.innerHeight - r.top + MENU_GAP } : { top: r.bottom + MENU_GAP }),
        });
    }

    function pick(i: number) {
        const o = options[i];
        if (o) onChange(o.value);
        close(true);
    }

    // Outside click or any scroll/resize that would leave the list floating.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (menu.current?.contains(t) || button.current?.contains(t)) return;
            setPos(null);
        };
        const onResize = () => setPos(null);
        // Scrolling elsewhere (a table gliding, a log) leaves the button where it is.
        const onScroll = (e: Event) => {
            const t = e.target;
            if (t instanceof Node && t !== document && !t.contains(button.current) ) return;
            if (t instanceof Node && menu.current?.contains(t)) return;
            setPos(null);
        };
        document.addEventListener('mousedown', onDown);
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [open]);

    // Focus the list when it opens, and keep the highlighted option in view.
    useEffect(() => {
        if (open) menu.current?.focus({ preventScroll: true });
    }, [open]);
    useEffect(() => {
        if (!open) return;
        menu.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [open, cursor]);

    function onButtonKey(e: React.KeyboardEvent) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            openMenu();
        }
    }

    function onMenuKey(e: React.KeyboardEvent) {
        const last = options.length - 1;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setCursor((c) => Math.min(last, c + 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
                break;
            case 'Home':
                e.preventDefault();
                setCursor(0);
                break;
            case 'End':
                e.preventDefault();
                setCursor(last);
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                pick(cursor);
                break;
            case 'Escape':
                // Only the list closes, not the dialog that holds it.
                e.preventDefault();
                e.stopPropagation();
                close(true);
                break;
            case 'Tab':
                setPos(null);
                break;
            default:
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    // Type-ahead: letters typed together jump to the next match.
                    const now = Date.now();
                    const t = typed.current;
                    t.text = now - t.at > 600 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
                    t.at = now;
                    const from = t.text.length === 1 ? cursor + 1 : cursor;
                    for (let k = 0; k < options.length; k++) {
                        const i = (from + k) % options.length;
                        if (options[i].label.toLowerCase().startsWith(t.text)) {
                            setCursor(i);
                            break;
                        }
                    }
                }
        }
    }

    return (
        <>
            <button
                ref={button}
                type="button"
                className={`select${active ? ' select--active' : ''}${className ? ' ' + className : ''}`}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                aria-label={ariaLabel}
                disabled={disabled}
                onClick={() => (open ? close(false) : openMenu())}
                onKeyDown={onButtonKey}
            >
                {/* Every option is laid out in the same cell, only the chosen one visible:
                    the button is as wide as the longest option and never resizes. */}
                <span className="select__stack">
                    {options.map((o, i) => (
                        <span key={o.value} className="select__item" style={i === selected ? undefined : { visibility: 'hidden' }} aria-hidden={i !== selected}>
                            <span className="select__value">{o.label}</span>
                            {o.detail && <span className="select__detail">{o.detail}</span>}
                        </span>
                    ))}
                </span>
                <ChevronIcon size={12} className="select__chevron" />
            </button>
            {pos &&
                createPortal(
                    <ul
                        ref={menu}
                        id={id}
                        role="listbox"
                        tabIndex={-1}
                        aria-label={ariaLabel}
                        aria-activedescendant={`${id}-${cursor}`}
                        className="select__menu"
                        style={{ ...pos, ...(align === 'end' ? { transform: 'translateX(-100%)' } : null) }}
                        onKeyDown={onMenuKey}
                    >
                        {options.map((o, i) => (
                            <li
                                key={o.value}
                                id={`${id}-${i}`}
                                data-i={i}
                                role="option"
                                aria-selected={i === selected}
                                className={`select__option${i === cursor ? ' select__option--cursor' : ''}${i === selected ? ' select__option--on' : ''}`}
                                onMouseMove={() => i !== cursor && setCursor(i)}
                                onClick={() => pick(i)}
                            >
                                <span className="select__label">{o.label}</span>
                                {o.detail && <span className="select__detail">{o.detail}</span>}
                            </li>
                        ))}
                    </ul>,
                    document.body
                )}
        </>
    );
}

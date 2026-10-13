import { useCallback, useState } from 'react';

/** A set of selected row keys, for the batch actions of a table. */
export function useSelection<K>() {
    const [selected, setSelected] = useState<Set<K>>(new Set());

    const toggle = useCallback((key: K) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (!next.delete(key)) next.add(key);
            return next;
        });
    }, []);

    /** Select (on) or deselect (off) every key in the list at once. */
    const setMany = useCallback((keys: K[], on: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            for (const k of keys) {
                if (on) next.add(k);
                else next.delete(k);
            }
            return next;
        });
    }, []);

    const clear = useCallback(() => setSelected(new Set()), []);

    return { selected, toggle, setMany, clear };
}

/** True when a click landed on a control inside the row (button, link, checkbox) rather than on the card itself. */
export function clickedControl(e: { target: EventTarget }): boolean {
    return (e.target as HTMLElement).closest('button, a, input, label') !== null;
}

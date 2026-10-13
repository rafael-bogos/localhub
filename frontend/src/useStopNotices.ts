import { useCallback, useEffect, useRef, useState } from 'react';
import { EventsOn } from '../wailsjs/runtime/runtime';

/** A container that stopped, as the backend reports it (local or from a connected server). */
export interface StopNotice {
    id: string;
    /** "stopped": clean exit; "killed": ended by a signal (stop, compose down); "failed": exit with error. */
    kind: 'stopped' | 'killed' | 'failed';
    title: string;
    detail: string;
    /** Empty for the local machine. */
    hostId: string;
    hostName: string;
    containerId: string;
    name: string;
    image: string;
    exitCode: number;
    /** Unix milliseconds. */
    at: number;
    read: boolean;
}

/** Notices kept in the panel; older ones fall off. */
const MAX_KEPT = 50;
/** Toasts on screen at once. */
const MAX_TOASTS = 3;

export interface StopNotices {
    notices: StopNotice[];
    unread: number;
    /** Ids shown as toasts right now, newest last. */
    toasts: StopNotice[];
    dismissToast: (id: string) => void;
    markAllRead: () => void;
    remove: (id: string) => void;
    clear: () => void;
}

/**
 * The history of "container stopped" events for this session, plus which ones
 * are still showing as toasts. While the panel is open (`quiet`) new notices
 * arrive already read and without a toast: the list itself is the feedback.
 */
export function useStopNotices(quiet: boolean): StopNotices {
    const [notices, setNotices] = useState<StopNotice[]>([]);
    const [toastIds, setToastIds] = useState<string[]>([]);
    const quietRef = useRef(quiet);
    quietRef.current = quiet;

    useEffect(() => {
        return EventsOn('container:stopped', (raw: Omit<StopNotice, 'read'>) => {
            if (!raw?.id) return;
            const quietNow = quietRef.current;
            setNotices((prev) => [{ ...raw, read: quietNow }, ...prev].slice(0, MAX_KEPT));
            if (!quietNow) setToastIds((prev) => [...prev, raw.id].slice(-MAX_TOASTS));
        });
    }, []);

    const dismissToast = useCallback((id: string) => setToastIds((prev) => prev.filter((t) => t !== id)), []);
    const markAllRead = useCallback(() => {
        setNotices((prev) => (prev.some((n) => !n.read) ? prev.map((n) => ({ ...n, read: true })) : prev));
        setToastIds([]);
    }, []);
    const remove = useCallback((id: string) => {
        setNotices((prev) => prev.filter((n) => n.id !== id));
        setToastIds((prev) => prev.filter((t) => t !== id));
    }, []);
    const clear = useCallback(() => {
        setNotices([]);
        setToastIds([]);
    }, []);

    const toasts = toastIds.map((id) => notices.find((n) => n.id === id)).filter((n): n is StopNotice => !!n);
    return { notices, unread: notices.filter((n) => !n.read).length, toasts, dismissToast, markAllRead, remove, clear };
}

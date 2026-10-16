import { useEffect, useRef, type RefObject } from 'react';

const EASE = 0.2; // share of the remaining distance covered each frame
const MIN_WHEEL = 40; // smaller wheel steps are a touchpad, which is already smooth

/**
 * Eases mouse-wheel scrolling of one scroll area. WebKitGTK jumps a whole
 * notch at once; this glides there instead, on both axes. Touchpads, the
 * scrollbar, the keyboard and "reduce motion" keep their native behavior, and
 * at the end of the area the wheel passes through to the page.
 * `movingClass` is on the element while it glides, so CSS can switch off hover
 * effects that would repaint every cell passed over.
 */
export function useSmoothScroll(ref: RefObject<HTMLElement | null>, movingClass: string) {
    const frame = useRef(0);

    useEffect(() => {
        const el = ref.current;
        if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const target = { x: 0, y: 0 };

        const step = () => {
            const dx = target.x - el.scrollLeft;
            const dy = target.y - el.scrollTop;
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
                el.scrollLeft = target.x;
                el.scrollTop = target.y;
                frame.current = 0;
                el.classList.remove(movingClass);
                return;
            }
            // At least a pixel per frame: browsers round scroll offsets, so a
            // smaller step would never arrive.
            el.scrollLeft += Math.abs(dx) < 1 ? dx : Math.sign(dx) * Math.max(1, Math.abs(dx) * EASE);
            el.scrollTop += Math.abs(dy) < 1 ? dy : Math.sign(dy) * Math.max(1, Math.abs(dy) * EASE);
            frame.current = requestAnimationFrame(step);
        };

        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.defaultPrevented) return;
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
            let dx = e.deltaX * unit;
            let dy = e.deltaY * unit;
            if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
            if (Math.max(Math.abs(dx), Math.abs(dy)) < MIN_WHEEL && e.deltaMode === 0) return;

            const maxX = el.scrollWidth - el.clientWidth;
            const maxY = el.scrollHeight - el.clientHeight;
            if (!frame.current) {
                target.x = el.scrollLeft;
                target.y = el.scrollTop;
            }
            const nx = Math.min(maxX, Math.max(0, target.x + dx));
            const ny = Math.min(maxY, Math.max(0, target.y + dy));
            // Nothing left to scroll this way: let the page have the wheel.
            if (nx === target.x && ny === target.y) return;

            e.preventDefault();
            target.x = nx;
            target.y = ny;
            el.classList.add(movingClass);
            if (!frame.current) frame.current = requestAnimationFrame(step);
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            el.removeEventListener('wheel', onWheel);
            cancelAnimationFrame(frame.current);
            frame.current = 0;
            el.classList.remove(movingClass);
        };
    }, [ref, movingClass]);
}

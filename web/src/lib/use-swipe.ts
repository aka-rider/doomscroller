import { onMount, onCleanup } from 'solid-js';

export interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  onMove?: (deltaX: number) => void;
  /** fired=true if threshold crossed, false if released early (spring back) */
  onEnd?: (fired: boolean) => void;
}

export const useSwipe = (
  getEl: () => HTMLElement | undefined,
  handlers: SwipeHandlers,
) => {
  const threshold = handlers.threshold ?? 80;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let swiped = false;
  let deltaX = 0;
  let locked = false;

  const onTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
    locked = false;
    swiped = false;
    deltaX = 0;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!tracking) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    // First significant movement decides axis
    if (!locked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      if (Math.abs(dy) > Math.abs(dx)) {
        tracking = false;
        handlers.onMove?.(0);
        return;
      }
      locked = true;
    }

    if (!locked) return;
    deltaX = dx;
    handlers.onMove?.(deltaX);
  };

  const onTouchEnd = () => {
    if (!tracking) {
      handlers.onEnd?.(false);
      return;
    }
    tracking = false;

    const fired = Math.abs(deltaX) >= threshold;
    if (fired) {
      swiped = true;
      if (deltaX > 0) {
        handlers.onSwipeRight?.();
      } else {
        handlers.onSwipeLeft?.();
      }
    }

    handlers.onEnd?.(fired);
  };

  const onClickCapture = (e: Event) => {
    if (swiped) {
      e.preventDefault();
      e.stopPropagation();
      swiped = false;
    }
  };

  onMount(() => {
    const el = getEl();
    if (!el) return;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('click', onClickCapture, true);

    onCleanup(() => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('click', onClickCapture, true);
    });
  });
};

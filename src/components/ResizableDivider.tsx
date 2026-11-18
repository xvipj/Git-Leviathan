import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  KEYBOARD_STEP,
  resolveDragWidth,
  stepSideWidth,
} from "../lib/layout";

type DividerSide = "left" | "right" | "bottom";

interface ResizableDividerProps {
  side: DividerSide;
  value: number;
  min: number;
  max: number;
  collapsed?: boolean;
  label: string;
  controls?: string;
  /** Actualización inmediata (variable CSS) sin re-render de React. */
  onPreview?: (value: number) => void;
  onResize: (value: number) => void;
  onToggle: () => void;
  onReset: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Separador accesible y reutilizable. El arrastre se limita a un
 * `requestAnimationFrame` por frame para no recalcular el layout en cada
 * evento del puntero.
 */
export function ResizableDivider({
  side,
  value,
  min,
  max,
  collapsed = false,
  label,
  controls,
  onPreview,
  onResize,
  onToggle,
  onReset,
}: ResizableDividerProps) {
  const frame = useRef(0);
  const pending = useRef<number | null>(null);
  const dragging = useRef(false);
  const latest = useRef({ onPreview, onResize, min, max });
  latest.current = { onPreview, onResize, min, max };

  useEffect(
    () => () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
      document.body.classList.remove("is-resizing", "is-resizing-vertical", "is-resizing-horizontal");
    },
    [],
  );

  const flush = () => {
    frame.current = 0;
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    const { onPreview: preview, onResize: commit } = latest.current;
    if (preview) preview(next);
    else commit(next);
  };

  const schedule = (next: number) => {
    pending.current = next;
    if (!frame.current) frame.current = window.requestAnimationFrame(flush);
  };

  const finish = () => {
    dragging.current = false;
    document.body.classList.remove("is-resizing", "is-resizing-vertical", "is-resizing-horizontal");
    if (frame.current) {
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
    if (pending.current !== null) {
      const next = pending.current;
      pending.current = null;
      const { onPreview: preview, onResize: commit } = latest.current;
      if (preview) preview(next);
      commit(next);
    }
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    dragging.current = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const startValue = collapsed ? 0 : value;
    const axis = side === "bottom" ? "horizontal" : "vertical";
    document.body.classList.add("is-resizing", `is-resizing-${axis}`);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (!dragging.current) return;
      const delta =
        side === "left"
          ? moveEvent.clientX - startX
          : side === "right"
            ? startX - moveEvent.clientX
            : startY - moveEvent.clientY;
      const raw = startValue + delta;
      const { max: currentMax, min: currentMin } = latest.current;
      const next =
        side === "bottom"
          ? Math.round(clamp(raw, currentMin, currentMax))
          : resolveDragWidth(raw, currentMin, currentMax);
      schedule(next);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      finish();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle();
      return;
    }

    let direction = 0;
    if (side === "bottom") {
      if (event.key === "ArrowUp") direction = 1;
      if (event.key === "ArrowDown") direction = -1;
    } else if (event.key === "ArrowLeft") {
      direction = side === "left" ? -1 : 1;
    } else if (event.key === "ArrowRight") {
      direction = side === "left" ? 1 : -1;
    }

    if (direction === 0) return;
    event.preventDefault();
    if (side === "bottom") {
      onResize(clamp(value + direction * KEYBOARD_STEP, min, max));
    } else {
      const next = stepSideWidth(
        collapsed ? 0 : value,
        collapsed,
        direction * KEYBOARD_STEP,
        min,
        max,
      );
      onResize(next);
    }
  };

  const orientation = side === "bottom" ? "horizontal" : "vertical";
  const now = collapsed ? 0 : Math.round(value);
  return (
    <div
      className={`resize-divider ${orientation} ${side} ${collapsed ? "is-collapsed" : ""}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={now}
      tabIndex={0}
      title={`${label} · doble clic para restaurar`}
      onPointerDown={startResize}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="resize-divider-grip" aria-hidden="true" />
      <span className="sr-only">{`${label}. Usa las flechas para mover y Enter para plegar o desplegar.`}</span>
    </div>
  );
}

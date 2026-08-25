import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

type LayoutKind = "rail" | "sidebar" | "composer";

interface DragState {
  kind: LayoutKind;
  startX: number;
  startY: number;
  startValue: number;
}

interface LayoutState {
  rail: number;
  sidebar: number;
  composer: number;
  railTouched: boolean;
  sidebarTouched: boolean;
  composerTouched: boolean;
  drag: DragState | null;
}

function defaultSidebarWidth(): number {
  return window.innerWidth < 900 ? 240 : 280;
}

function boundsFor(kind: LayoutKind, rail: number): { min: number; max: number } {
  const viewportWidth = Math.max(window.innerWidth || 0, 680);
  const viewportHeight = Math.max(window.innerHeight || 0, 300);
  if (kind === "rail") {
    return { min: 56, max: Math.max(56, Math.min(184, viewportWidth - 220 - 360)) };
  }
  if (kind === "sidebar") {
    return { min: 220, max: Math.max(220, Math.min(420, viewportWidth - rail - 360)) };
  }
  return { min: 120, max: Math.max(120, Math.min(320, viewportHeight - 60 - 120)) };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function useChatLayout() {
  const [layout, setLayout] = useState<LayoutState>({
    rail: 56,
    sidebar: defaultSidebarWidth(),
    composer: 180,
    railTouched: false,
    sidebarTouched: false,
    composerTouched: false,
    drag: null,
  });

  const updateLayout = useCallback((kind: LayoutKind, value: number, markTouched = true) => {
    setLayout((current) => {
      const bounds = boundsFor(kind, current.rail);
      const nextValue = clamp(value, bounds.min, bounds.max);
      if (kind === "rail") {
        return { ...current, rail: nextValue, railTouched: markTouched || current.railTouched };
      }
      if (kind === "sidebar") {
        return { ...current, sidebar: nextValue, sidebarTouched: markTouched || current.sidebarTouched };
      }
      return {
        ...current,
        composer: nextValue,
        composerTouched: markTouched || current.composerTouched,
      };
    });
  }, []);

  const resetLayout = useCallback((kind: LayoutKind) => {
    const defaults = { rail: 56, sidebar: defaultSidebarWidth(), composer: 180 };
    updateLayout(kind, defaults[kind], false);
    setLayout((current) => {
      if (kind === "rail") {
        return { ...current, railTouched: false };
      }
      if (kind === "sidebar") {
        return { ...current, sidebarTouched: false };
      }
      return { ...current, composerTouched: false };
    });
  }, [updateLayout]);

  useEffect(() => {
    const handleResize = () => {
      setLayout((current) => {
        const nextSidebar = current.sidebarTouched ? current.sidebar : defaultSidebarWidth();
        return {
          ...current,
          rail: clamp(current.rail, boundsFor("rail", current.rail).min, boundsFor("rail", current.rail).max),
          sidebar: clamp(nextSidebar, boundsFor("sidebar", current.rail).min, boundsFor("sidebar", current.rail).max),
          composer: clamp(current.composer, boundsFor("composer", current.rail).min, boundsFor("composer", current.rail).max),
        };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const startDrag = useCallback((kind: LayoutKind, event: PointerEvent<HTMLElement>) => {
    const startValue = layout[kind];
    event.currentTarget.setPointerCapture(event.pointerId);
    setLayout((current) => ({ ...current, drag: { kind, startX: event.clientX, startY: event.clientY, startValue } }));
  }, [layout]);

  const moveDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = layout.drag;
    if (!drag) {
      return;
    }
    const delta = drag.kind === "composer" ? drag.startY - event.clientY : event.clientX - drag.startX;
    updateLayout(drag.kind, drag.startValue + delta);
  }, [layout.drag, updateLayout]);

  const finishDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (layout.drag) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setLayout((current) => ({ ...current, drag: null }));
  }, [layout.drag]);

  const handleKeyDown = useCallback((kind: LayoutKind, event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "Home") {
      event.preventDefault();
      updateLayout(kind, boundsFor(kind, layout.rail).min);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      updateLayout(kind, boundsFor(kind, layout.rail).max);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      updateLayout(kind, layout[kind] - step);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      updateLayout(kind, layout[kind] + step);
    }
  }, [layout, updateLayout]);

  return useMemo(() => ({
    layout,
    style: {
      "--rail-width": `${layout.rail}px`,
      "--sidebar-width": `${layout.sidebar}px`,
      "--composer-height": `${layout.composer}px`,
    } as CSSProperties,
    railExpanded: layout.rail > 96,
    resizerProps: (kind: LayoutKind) => {
      const bounds = boundsFor(kind, layout.rail);
      return {
        role: "separator",
        tabIndex: 0,
        "aria-orientation": kind === "composer" ? "horizontal" as const : "vertical" as const,
        "aria-valuemin": bounds.min,
        "aria-valuemax": bounds.max,
        "aria-valuenow": Math.round(layout[kind]),
        "data-resizer": kind,
        onPointerDown: (event: PointerEvent<HTMLElement>) => startDrag(kind, event),
        onPointerMove: moveDrag,
        onPointerUp: finishDrag,
        onPointerCancel: finishDrag,
        onDoubleClick: () => resetLayout(kind),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => handleKeyDown(kind, event),
      };
    },
  }), [finishDrag, handleKeyDown, layout, moveDrag, resetLayout, startDrag]);
}

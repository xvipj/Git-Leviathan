import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  COMPACT_BREAKPOINT,
  DEFAULT_TERMINAL_HEIGHT,
  createDefaultLayout,
  fitSideWidths,
  fitTerminalHeight,
  parseStoredLayout,
  sideMaxWidth,
  terminalMaxHeight,
  type LayoutConfig,
  type ShortcutMap,
  type Side,
  type SidebarSectionId,
} from "../lib/layout";

export interface SectionRequest {
  id: SidebarSectionId;
  token: number;
}

/**
 * Estado del diseño de la interfaz. El diseño persistido es global; el modo
 * compacto y el modo enfoque son estado de ejecución y no modifican las
 * preferencias guardadas del usuario.
 */
export function useLayout() {
  const [layout, setLayout] = useState<LayoutConfig>(createDefaultLayout);
  const [ready, setReady] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: typeof window === "undefined" ? 1400 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  const [focusMode, setFocusMode] = useState(false);
  const [overlayLeft, setOverlayLeft] = useState(false);
  const [overlayRight, setOverlayRight] = useState(false);
  const [sectionRequest, setSectionRequest] = useState<SectionRequest | null>(
    null,
  );
  const saveTimer = useRef<number | undefined>(undefined);
  const sectionToken = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void api
      .loadLayout()
      .then((raw) => {
        if (cancelled) return;
        setLayout(parseStoredLayout(raw));
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api.saveLayout(layout).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(saveTimer.current);
  }, [layout, ready]);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setWindowSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const compact = windowSize.width < COMPACT_BREAKPOINT;

  useEffect(() => {
    if (!compact) return;
    setOverlayLeft(false);
    setOverlayRight(false);
  }, [compact]);

  const closeOverlays = useCallback(() => {
    setOverlayLeft(false);
    setOverlayRight(false);
  }, []);

  useEffect(() => {
    if (!overlayLeft && !overlayRight) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOverlays();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayLeft, overlayRight, closeOverlays]);

  const setSideWidth = useCallback((side: Side, width: number) => {
    setLayout((current) => {
      if (width <= 0) {
        if (current[side].collapsed) return current;
        return {
          ...current,
          [side]: { ...current[side], collapsed: true },
        };
      }
      return {
        ...current,
        [side]: {
          ...current[side],
          width: Math.max(1, Math.round(width)),
          collapsed: false,
        },
      };
    });
  }, []);

  /**
   * Durante el arrastre solo se escribe una variable CSS en el contenedor:
   * así el grafo y los diffs no se vuelven a renderizar en cada frame. El
   * estado de React se actualiza al soltar.
   */
  const previewSideWidth = useCallback((side: Side, width: number) => {
    const root = document.querySelector<HTMLElement>(".app");
    root?.style.setProperty(
      side === "left" ? "--left-width" : "--right-width",
      `${Math.max(0, Math.round(width))}px`,
    );
  }, []);

  const commitSideWidth = useCallback(
    (side: Side, width: number) => {
      // No se elimina la variable CSS: React la mantiene en el mismo valor
      // tras el commit y así el panel no salta al valor por defecto.
      setSideWidth(side, width);
    },
    [setSideWidth],
  );

  const previewTerminalHeight = useCallback((height: number) => {
    const root = document.querySelector<HTMLElement>(".app");
    root?.style.setProperty(
      "--terminal-height",
      `${Math.max(0, Math.round(height))}px`,
    );
  }, []);

  const commitTerminalHeight = useCallback((height: number) => {
    setLayout((current) => ({
      ...current,
      terminal: {
        ...current.terminal,
        height: Math.max(1, Math.round(height)),
        collapsed: false,
      },
    }));
  }, []);

  const toggleLeft = useCallback(() => {
    if (focusMode) {
      setFocusMode(false);
      setOverlayLeft(compact);
      setOverlayRight(false);
      if (!compact) {
        setLayout((current) => ({
          ...current,
          left: { ...current.left, collapsed: false },
        }));
      }
      return;
    }
    if (compact) {
      setOverlayLeft((value) => !value);
      setOverlayRight(false);
      return;
    }
    setLayout((current) => ({
      ...current,
      left: { ...current.left, collapsed: !current.left.collapsed },
    }));
  }, [compact, focusMode]);

  const toggleRight = useCallback(() => {
    if (focusMode) {
      setFocusMode(false);
      setOverlayRight(compact);
      setOverlayLeft(false);
      if (!compact) {
        setLayout((current) => ({
          ...current,
          right: { ...current.right, collapsed: false },
        }));
      }
      return;
    }
    if (compact) {
      setOverlayRight((value) => !value);
      setOverlayLeft(false);
      return;
    }
    setLayout((current) => ({
      ...current,
      right: { ...current.right, collapsed: !current.right.collapsed },
    }));
  }, [compact, focusMode]);

  const toggleTerminal = useCallback(() => {
    if (focusMode) {
      setFocusMode(false);
      setLayout((current) => ({
        ...current,
        terminal: { ...current.terminal, collapsed: false },
      }));
      return;
    }
    setLayout((current) => ({
      ...current,
      terminal: {
        ...current.terminal,
        collapsed: !current.terminal.collapsed,
      },
    }));
  }, [focusMode]);

  const toggleFocusMode = useCallback(() => {
    setOverlayLeft(false);
    setOverlayRight(false);
    setFocusMode((value) => !value);
  }, []);

  const openLeftSection = useCallback(
    (id: SidebarSectionId) => {
      setFocusMode(false);
      setLayout((current) => ({
        ...current,
        left: {
          ...current.left,
          collapsed: compact ? current.left.collapsed : false,
          sections: { ...current.left.sections, [id]: false },
        },
      }));
      if (compact) {
        setOverlayLeft(true);
        setOverlayRight(false);
      }
      sectionToken.current += 1;
      setSectionRequest({ id, token: sectionToken.current });
    },
    [compact],
  );

  const openRightPanel = useCallback(() => {
    setFocusMode(false);
    if (compact) {
      setOverlayRight(true);
      setOverlayLeft(false);
      return;
    }
    setLayout((current) => ({
      ...current,
      right: { ...current.right, collapsed: false },
    }));
  }, [compact]);

  const toggleSection = useCallback((id: SidebarSectionId) => {
    setLayout((current) => ({
      ...current,
      left: {
        ...current.left,
        sections: {
          ...current.left.sections,
          [id]: !current.left.sections[id],
        },
      },
    }));
  }, []);

  const setShortcuts = useCallback((shortcuts: ShortcutMap) => {
    setLayout((current) => ({ ...current, shortcuts }));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(createDefaultLayout());
    setFocusMode(false);
    setOverlayLeft(false);
    setOverlayRight(false);
    setSectionRequest(null);
  }, []);

  const leftVisible = !focusMode && !compact && !layout.left.collapsed;
  const rightVisible = !focusMode && !compact && !layout.right.collapsed;
  const terminalVisible = !focusMode && !layout.terminal.collapsed;

  const fitted = useMemo(
    () =>
      fitSideWidths(
        windowSize.width,
        layout.left.width,
        layout.right.width,
        leftVisible,
        rightVisible,
      ),
    [windowSize.width, layout.left.width, layout.right.width, leftVisible, rightVisible],
  );

  const maxLeft = sideMaxWidth(
    windowSize.width,
    rightVisible ? fitted.right : 0,
    rightVisible,
  );
  const maxRight = sideMaxWidth(
    windowSize.width,
    leftVisible ? fitted.left : 0,
    leftVisible,
  );
  const maxTerminal = terminalMaxHeight(windowSize.height);
  const terminalHeight = fitTerminalHeight(
    layout.terminal.height || DEFAULT_TERMINAL_HEIGHT,
    windowSize.height,
  );

  return {
    layout,
    ready,
    compact,
    focusMode,
    overlayLeft: compact && overlayLeft && !focusMode,
    overlayRight: compact && overlayRight && !focusMode,
    leftVisible,
    rightVisible,
    terminalVisible,
    leftWidth: fitted.left,
    rightWidth: fitted.right,
    maxLeft,
    maxRight,
    terminalHeight,
    maxTerminal,
    sectionRequest,
    setSideWidth,
    previewSideWidth,
    commitSideWidth,
    previewTerminalHeight,
    commitTerminalHeight,
    toggleLeft,
    toggleRight,
    toggleTerminal,
    toggleFocusMode,
    openLeftSection,
    openRightPanel,
    toggleSection,
    closeOverlays,
    setShortcuts,
    resetLayout,
  };
}

export type LayoutController = ReturnType<typeof useLayout>;

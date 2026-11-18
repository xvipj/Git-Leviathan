import { describe, expect, it } from "vitest";
import {
  COMPACT_BREAKPOINT,
  DEFAULT_LEFT_WIDTH,
  DEFAULT_RIGHT_WIDTH,
  DEFAULT_SHORTCUTS,
  DEFAULT_TERMINAL_HEIGHT,
  DIVIDER_SIZE,
  KEYBOARD_STEP,
  MAX_SIDE_RATIO,
  MIN_GRAPH_WIDTH,
  MIN_SIDE_WIDTH,
  MIN_TERMINAL_HEIGHT,
  RAIL_WIDTH,
  createDefaultLayout,
  fitSideWidths,
  fitTerminalHeight,
  matchesShortcut,
  normalizeShortcut,
  parseStoredLayout,
  resolveDragWidth,
  sanitizeLayout,
  serializeLayout,
  sideMaxWidth,
  stepSideWidth,
  terminalMaxHeight,
} from "./layout";

const keyboard = (
  key: string,
  mods: Partial<{
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  }> = {},
) => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("límites de tamaño", () => {
  it("nunca deja el grafo por debajo del mínimo aunque el panel llegue al máximo", () => {
    const width = 1400;
    const max = sideMaxWidth(width, DEFAULT_RIGHT_WIDTH, true);
    const graph = width - max - DEFAULT_RIGHT_WIDTH - DIVIDER_SIZE * 2;
    expect(max).toBeLessThanOrEqual(Math.round(width * MAX_SIDE_RATIO));
    expect(graph).toBeGreaterThanOrEqual(MIN_GRAPH_WIDTH);
  });

  it("respeta el mínimo de cada panel al ajustar la ventana", () => {
    const fitted = fitSideWidths(1400, 120, 900, true, true);
    expect(fitted.left).toBe(MIN_SIDE_WIDTH);
    expect(fitted.right).toBeGreaterThanOrEqual(MIN_SIDE_WIDTH);
    expect(fitted.left + fitted.right + DIVIDER_SIZE * 2 + MIN_GRAPH_WIDTH).toBeLessThanOrEqual(
      1400,
    );
  });

  it("descuenta la barra de iconos cuando el panel contrario está plegado", () => {
    const windowWidth = 900;
    const max = sideMaxWidth(windowWidth, 0, false);
    const graph = windowWidth - max - DIVIDER_SIZE - RAIL_WIDTH;
    expect(graph).toBeGreaterThanOrEqual(MIN_GRAPH_WIDTH);
  });

  it("reduce ambos paneles de forma proporcional si no cabe el grafo", () => {
    const windowWidth = 1000;
    const fitted = fitSideWidths(windowWidth, 700, 700, true, true);
    const graph = windowWidth - fitted.left - fitted.right - DIVIDER_SIZE * 2;
    expect(graph).toBeGreaterThanOrEqual(MIN_GRAPH_WIDTH);
    expect(fitted.left).toBeGreaterThanOrEqual(MIN_SIDE_WIDTH);
    expect(fitted.right).toBeGreaterThanOrEqual(MIN_SIDE_WIDTH);
  });

  it("ignora el ancho de un panel plegado", () => {
    const fitted = fitSideWidths(1000, 700, 700, false, true);
    expect(fitted.left).toBe(0);
    expect(fitted.right).toBeGreaterThanOrEqual(MIN_SIDE_WIDTH);
  });

  it("limita la altura de la terminal a la ventana", () => {
    expect(fitTerminalHeight(10, 900)).toBe(MIN_TERMINAL_HEIGHT);
    expect(fitTerminalHeight(5000, 900)).toBe(terminalMaxHeight(900));
    expect(fitTerminalHeight(300, 900)).toBe(300);
  });
});

describe("plegado automático al arrastrar", () => {
  it("pliega por debajo del mínimo y se reabre al cruzar de nuevo", () => {
    expect(resolveDragWidth(MIN_SIDE_WIDTH - 1)).toBe(0);
    expect(resolveDragWidth(MIN_SIDE_WIDTH)).toBe(MIN_SIDE_WIDTH);
    expect(resolveDragWidth(MIN_SIDE_WIDTH + 60)).toBe(MIN_SIDE_WIDTH + 60);
  });

  it("recorta por encima del máximo", () => {
    expect(resolveDragWidth(9000, MIN_SIDE_WIDTH, 640)).toBe(640);
  });

  it("con teclado, un paso hacia fuera abre el panel plegado", () => {
    expect(stepSideWidth(0, true, KEYBOARD_STEP)).toBe(MIN_SIDE_WIDTH);
    expect(stepSideWidth(MIN_SIDE_WIDTH, true, -KEYBOARD_STEP)).toBe(0);
    expect(stepSideWidth(MIN_SIDE_WIDTH, false, -KEYBOARD_STEP)).toBe(MIN_SIDE_WIDTH);
    expect(stepSideWidth(300, false, KEYBOARD_STEP)).toBe(310);
  });
});

describe("persistencia del diseño", () => {
  it("usa los valores por defecto si falta el archivo", () => {
    const layout = parseStoredLayout(null);
    expect(layout).toEqual(createDefaultLayout());
  });

  it("usa los valores por defecto si el archivo está corrupto", () => {
    const layout = parseStoredLayout("{ esto no es json");
    expect(layout.left.width).toBe(DEFAULT_LEFT_WIDTH);
    expect(layout.right.width).toBe(DEFAULT_RIGHT_WIDTH);
    expect(layout.terminal.height).toBe(DEFAULT_TERMINAL_HEIGHT);
    expect(layout.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it("restaura el diseño guardado con todos sus detalles", () => {
    const saved = createDefaultLayout();
    saved.left.width = 318;
    saved.left.collapsed = true;
    saved.left.sections.tags = true;
    saved.left.sections.stashes = true;
    saved.right.width = 501;
    saved.right.collapsed = false;
    saved.terminal.height = 355;
    saved.terminal.collapsed = false;
    saved.shortcuts.toggleLeft = "Ctrl+Shift+L";

    const restored = parseStoredLayout(serializeLayout(saved));
    expect(restored).toEqual(saved);
  });

  it("sanea valores fuera de rango y tipos incorrectos", () => {
    const layout = sanitizeLayout({
      left: { width: 5, collapsed: "sí", sections: { tags: true, local: "no" } },
      right: { width: 99999 },
      terminal: { height: -40 },
      shortcuts: { toggleLeft: "B", toggleRight: 42 },
    });
    expect(layout.left.width).toBe(MIN_SIDE_WIDTH);
    expect(layout.left.collapsed).toBe(false);
    expect(layout.left.sections.tags).toBe(true);
    expect(layout.left.sections.local).toBe(false);
    expect(layout.right.width).toBeGreaterThanOrEqual(MIN_SIDE_WIDTH);
    expect(layout.terminal.height).toBe(MIN_TERMINAL_HEIGHT);
    expect(layout.shortcuts.toggleLeft).toBe(DEFAULT_SHORTCUTS.toggleLeft);
    expect(layout.shortcuts.toggleRight).toBe(DEFAULT_SHORTCUTS.toggleRight);
  });
});

describe("atajos de teclado", () => {
  it("normaliza combinaciones y rechaza las que no llevan modificador", () => {
    expect(normalizeShortcut("ctrl+b")).toBe("Ctrl+B");
    expect(normalizeShortcut("Alt+Control+B")).toBe("Ctrl+Alt+B");
    expect(normalizeShortcut("b")).toBeNull();
    expect(normalizeShortcut("Ctrl+")).toBeNull();
  });

  it("coincide con la combinación exacta", () => {
    expect(matchesShortcut(keyboard("b", { ctrlKey: true }), "Ctrl+B")).toBe(true);
    expect(matchesShortcut(keyboard("b", { ctrlKey: true, altKey: true }), "Ctrl+B")).toBe(
      false,
    );
    expect(matchesShortcut(keyboard("B", { ctrlKey: true, altKey: true }), "Ctrl+Alt+B")).toBe(
      true,
    );
    expect(matchesShortcut(keyboard("f", { ctrlKey: true, shiftKey: true }), "Ctrl+Shift+F")).toBe(
      true,
    );
  });

  it("mantiene el umbral compacto por debajo de 900 px", () => {
    expect(COMPACT_BREAKPOINT).toBe(900);
  });
});

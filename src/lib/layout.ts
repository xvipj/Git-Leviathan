/**
 * Lógica pura del diseño de paneles.
 *
 * El diseño se guarda de forma global en un único archivo de la app
 * (`leviathan-layout.json`). La aplicación es de una sola ventana y comparte
 * también recents y tema, así que separar por ventana solo añadiría claves
 * inestables sin beneficio real.
 */

export type Side = "left" | "right";

export type SidebarSectionId =
  | "local"
  | "remote"
  | "tags"
  | "stashes"
  | "worktrees"
  | "remotes";

export type ShortcutId =
  | "toggleLeft"
  | "toggleRight"
  | "toggleTerminal"
  | "toggleFocus";

export type ShortcutMap = Record<ShortcutId, string>;

export interface SideLayout {
  width: number;
  collapsed: boolean;
  sections: Record<SidebarSectionId, boolean>;
}

export interface LayoutConfig {
  version: 1;
  left: SideLayout;
  right: Omit<SideLayout, "sections">;
  terminal: { height: number; collapsed: boolean };
  shortcuts: ShortcutMap;
}

export const MIN_SIDE_WIDTH = 200;
export const MAX_SIDE_RATIO = 0.5;
export const MIN_GRAPH_WIDTH = 360;
export const DIVIDER_SIZE = 8;
export const RAIL_WIDTH = 44;
export const KEYBOARD_STEP = 10;
export const COMPACT_BREAKPOINT = 900;
export const MIN_TERMINAL_HEIGHT = 140;
export const MAX_TERMINAL_RATIO = 0.72;
export const DEFAULT_LEFT_WIDTH = 286;
export const DEFAULT_RIGHT_WIDTH = 432;
export const DEFAULT_TERMINAL_HEIGHT = 290;
export const MAX_STORED_SIDE_WIDTH = 2000;
export const MAX_STORED_TERMINAL_HEIGHT = 1600;

export const SIDEBAR_SECTIONS: ReadonlyArray<{
  id: SidebarSectionId;
  label: string;
}> = [
  { id: "local", label: "Ramas locales" },
  { id: "remote", label: "Ramas remotas" },
  { id: "tags", label: "Etiquetas" },
  { id: "stashes", label: "Stashes" },
  { id: "worktrees", label: "Worktrees" },
  { id: "remotes", label: "Remotos" },
];

export const SHORTCUT_ACTIONS: ReadonlyArray<{
  id: ShortcutId;
  label: string;
  hint: string;
}> = [
  { id: "toggleLeft", label: "Panel izquierdo", hint: "Mostrar u ocultar el explorador" },
  { id: "toggleRight", label: "Panel derecho", hint: "Mostrar u ocultar detalles y commit" },
  { id: "toggleTerminal", label: "Terminal", hint: "Mostrar u ocultar la terminal" },
  { id: "toggleFocus", label: "Modo enfoque", hint: "Ocultar todos los paneles y dejar el grafo" },
];

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggleLeft: "Ctrl+B",
  toggleRight: "Ctrl+Alt+B",
  toggleTerminal: "Ctrl+J",
  toggleFocus: "Ctrl+Shift+F",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberIn(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(clamp(value, min, max));
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeSections(value: unknown): Record<SidebarSectionId, boolean> {
  const record = isRecord(value) ? value : {};
  const result = {} as Record<SidebarSectionId, boolean>;
  for (const section of SIDEBAR_SECTIONS) {
    result[section.id] = booleanOr(record[section.id], false);
  }
  return result;
}

function sanitizeShortcut(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = normalizeShortcut(value);
  return normalized ?? fallback;
}

export function createDefaultLayout(): LayoutConfig {
  return {
    version: 1,
    left: {
      width: DEFAULT_LEFT_WIDTH,
      collapsed: false,
      sections: sanitizeSections(null),
    },
    right: {
      width: DEFAULT_RIGHT_WIDTH,
      collapsed: false,
    },
    terminal: {
      height: DEFAULT_TERMINAL_HEIGHT,
      collapsed: true,
    },
    shortcuts: { ...DEFAULT_SHORTCUTS },
  };
}

export function sanitizeLayout(value: unknown): LayoutConfig {
  const defaults = createDefaultLayout();
  if (!isRecord(value)) return defaults;

  const left = isRecord(value.left) ? value.left : {};
  const right = isRecord(value.right) ? value.right : {};
  const terminal = isRecord(value.terminal) ? value.terminal : {};
  const shortcuts = isRecord(value.shortcuts) ? value.shortcuts : {};

  return {
    version: 1,
    left: {
      width: numberIn(
        left.width,
        defaults.left.width,
        MIN_SIDE_WIDTH,
        MAX_STORED_SIDE_WIDTH,
      ),
      collapsed: booleanOr(left.collapsed, defaults.left.collapsed),
      sections: sanitizeSections(left.sections),
    },
    right: {
      width: numberIn(
        right.width,
        defaults.right.width,
        MIN_SIDE_WIDTH,
        MAX_STORED_SIDE_WIDTH,
      ),
      collapsed: booleanOr(right.collapsed, defaults.right.collapsed),
    },
    terminal: {
      height: numberIn(
        terminal.height,
        defaults.terminal.height,
        MIN_TERMINAL_HEIGHT,
        MAX_STORED_TERMINAL_HEIGHT,
      ),
      collapsed: booleanOr(terminal.collapsed, defaults.terminal.collapsed),
    },
    shortcuts: {
      toggleLeft: sanitizeShortcut(
        shortcuts.toggleLeft,
        DEFAULT_SHORTCUTS.toggleLeft,
      ),
      toggleRight: sanitizeShortcut(
        shortcuts.toggleRight,
        DEFAULT_SHORTCUTS.toggleRight,
      ),
      toggleTerminal: sanitizeShortcut(
        shortcuts.toggleTerminal,
        DEFAULT_SHORTCUTS.toggleTerminal,
      ),
      toggleFocus: sanitizeShortcut(
        shortcuts.toggleFocus,
        DEFAULT_SHORTCUTS.toggleFocus,
      ),
    },
  };
}

export function parseStoredLayout(raw: string | null | undefined): LayoutConfig {
  if (!raw) return createDefaultLayout();
  try {
    return sanitizeLayout(JSON.parse(raw));
  } catch {
    return createDefaultLayout();
  }
}

export function serializeLayout(layout: LayoutConfig): string {
  return JSON.stringify(layout, null, 2);
}

export function sideMaxWidth(
  windowWidth: number,
  otherWidth: number,
  otherVisible: boolean,
): number {
  const half = Math.max(MIN_SIDE_WIDTH, Math.round(windowWidth * MAX_SIDE_RATIO));
  // El panel que se arrastra está abierto y gasta su propio separador. El otro
  // panel, si está plegado, deja una barra de iconos en lugar de un separador.
  const otherOverhead = otherVisible ? otherWidth + DIVIDER_SIZE : RAIL_WIDTH;
  const reservedForCenter =
    windowWidth - MIN_GRAPH_WIDTH - DIVIDER_SIZE - otherOverhead;
  return Math.max(MIN_SIDE_WIDTH, Math.min(half, reservedForCenter));
}

/**
 * Ajusta los anchos guardados al espacio real de la ventana. El ancho del
 * grafo siempre conserva al menos `MIN_GRAPH_WIDTH`; si no cabe, reduce ambos
 * paneles de forma proporcional por encima de su mínimo. Cada panel plegado
 * ocupa el ancho de su barra de iconos.
 */
export function fitSideWidths(
  windowWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftOpen: boolean,
  rightOpen: boolean,
): { left: number; right: number } {
  const half = Math.max(MIN_SIDE_WIDTH, Math.round(windowWidth * MAX_SIDE_RATIO));
  let left = leftOpen
    ? clamp(leftWidth, MIN_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, half))
    : 0;
  let right = rightOpen
    ? clamp(rightWidth, MIN_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, half))
    : 0;

  const leftOverhead = leftOpen ? DIVIDER_SIZE : RAIL_WIDTH;
  const rightOverhead = rightOpen ? DIVIDER_SIZE : RAIL_WIDTH;
  const available =
    windowWidth - MIN_GRAPH_WIDTH - leftOverhead - rightOverhead;
  const total = left + right;

  if (total > available) {
    const minTotal = (Number(leftOpen) + Number(rightOpen)) * MIN_SIDE_WIDTH;
    if (available <= minTotal) {
      left = leftOpen ? MIN_SIDE_WIDTH : 0;
      right = rightOpen ? MIN_SIDE_WIDTH : 0;
    } else {
      const flexLeft = leftOpen ? left - MIN_SIDE_WIDTH : 0;
      const flexRight = rightOpen ? right - MIN_SIDE_WIDTH : 0;
      const flexTotal = flexLeft + flexRight;
      const ratio = flexTotal > 0 ? (total - available) / flexTotal : 0;
      left -= flexLeft * Math.min(1, Math.max(0, ratio));
      right -= flexRight * Math.min(1, Math.max(0, ratio));
    }
  }

  return { left: Math.round(left), right: Math.round(right) };
}

/**
 * Convierte un ancho "en bruto" durante el arrastre en el ancho efectivo.
 * Devuelve 0 para indicar que el panel debe plegarse por snap. Mientras el
 * puntero siga presionado, volver a cruzar el mínimo lo despliega de nuevo.
 */
export function resolveDragWidth(
  rawWidth: number,
  minWidth = MIN_SIDE_WIDTH,
  maxWidth = MAX_STORED_SIDE_WIDTH,
): number {
  if (rawWidth < minWidth) return 0;
  return Math.round(clamp(rawWidth, minWidth, maxWidth));
}

/** Paso de teclado. Un panel plegado se abre con un paso hacia fuera. */
export function stepSideWidth(
  width: number,
  collapsed: boolean,
  delta: number,
  minWidth = MIN_SIDE_WIDTH,
  maxWidth = MAX_STORED_SIDE_WIDTH,
): number {
  if (collapsed) return delta > 0 ? minWidth : 0;
  if (delta === 0) return Math.round(clamp(width, minWidth, maxWidth));
  return Math.round(clamp(width + delta, minWidth, maxWidth));
}

export function terminalMaxHeight(windowHeight: number): number {
  return Math.max(
    MIN_TERMINAL_HEIGHT + 40,
    Math.round(windowHeight * MAX_TERMINAL_RATIO),
  );
}

export function fitTerminalHeight(
  height: number,
  windowHeight: number,
): number {
  return Math.round(
    clamp(height, MIN_TERMINAL_HEIGHT, terminalMaxHeight(windowHeight)),
  );
}

interface KeyboardLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

interface ParsedShortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

function normalizeKeyName(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed === " ") return "space";
  return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
}

/**
 * Acepta especificaciones como `Ctrl+B`, `Ctrl+Alt+B` o `Meta+Shift+F`.
 * Devuelve la forma canónica o `null` si la combinación no es válida.
 */
export function normalizeShortcut(value: string): string | null {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const key = parts.pop();
  if (!key || key.length > 20) return null;

  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "ctrl":
      case "control":
        ctrl = true;
        break;
      case "alt":
      case "option":
        alt = true;
        break;
      case "shift":
        shift = true;
        break;
      case "meta":
      case "cmd":
      case "command":
      case "win":
        meta = true;
        break;
      default:
        return null;
    }
  }

  if (!ctrl && !alt && !shift && !meta) return null;
  if (/[\s+]/u.test(key)) return null;

  const modifiers = [
    ctrl ? "Ctrl" : "",
    alt ? "Alt" : "",
    shift ? "Shift" : "",
    meta ? "Meta" : "",
  ].filter(Boolean);
  return [...modifiers, normalizeKeyName(key)].join("+");
}

export function isValidShortcut(value: string): boolean {
  return normalizeShortcut(value) !== null;
}

export function matchesShortcut(
  event: KeyboardLike,
  shortcut: string,
): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;
  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.metaKey === parsed.meta &&
    normalizeKeyName(event.key).toLowerCase() === parsed.key.toLowerCase()
  );
}

function parseShortcut(shortcut: string): ParsedShortcut | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return null;
  const parts = normalized.split("+");
  const key = parts.pop() ?? "";
  const lower = parts.map((part) => part.toLowerCase());
  return {
    ctrl: lower.includes("ctrl"),
    alt: lower.includes("alt"),
    shift: lower.includes("shift"),
    meta: lower.includes("meta"),
    key,
  };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

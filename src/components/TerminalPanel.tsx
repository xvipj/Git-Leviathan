import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Plus, X, TerminalSquare, GripHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { IconButton } from "./ui";

interface TerminalTab {
  id: string;
  label: string;
}

interface TerminalPanelProps {
  open: boolean;
  repoPath: string | null;
  onClose: () => void;
}

export function TerminalPanel({ open, repoPath, onClose }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [height, setHeight] = useState(290);
  const autoCreated = useRef(false);

  const createTab = () => {
    const id = `term-${crypto.randomUUID()}`;
    const number = tabs.length + 1;
    setTabs((current) => [...current, { id, label: `Terminal ${number}` }]);
    setActiveId(id);
    return id;
  };

  useEffect(() => {
    if (open && repoPath && tabs.length === 0 && !autoCreated.current) {
      autoCreated.current = true;
      createTab();
    }
    if (!open) {
      autoCreated.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repoPath, tabs.length]);

  useEffect(() => {
    if (!open || !repoPath) return;
    const fit = () => window.dispatchEvent(new Event("leviathan:terminal-fit"));
    fit();
  }, [open, activeId]);

  const closeTab = (id: string) => {
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      if (activeId === id) {
        setActiveId(next[next.length - 1]?.id ?? null);
      }
      return next;
    });
    api.terminalClose(id).catch(() => undefined);
  };

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(140, Math.min(window.innerHeight * 0.72, startHeight + (startY - moveEvent.clientY)));
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!repoPath) return null;

  return (
    <div className={`terminal-panel ${open ? "is-open" : ""}`} style={{ height: open ? height : 0 }}>
      {open && <div className="terminal-resize" onPointerDown={startResize} title="Redimensionar terminal">
        <GripHorizontal size={14} />
      </div>}
      <div className="terminal-tabs">
        <div className="terminal-tab-list">
          {tabs.map((tab) => (
            <div key={tab.id} className={`terminal-tab ${activeId === tab.id ? "is-active" : ""}`}>
              <button className="terminal-tab-main" onClick={() => setActiveId(tab.id)}>
                <TerminalSquare size={12} />
                {tab.label}
              </button>
              <button className="terminal-tab-close" onClick={() => closeTab(tab.id)} title="Cerrar terminal">
                <X size={11} />
              </button>
            </div>
          ))}
          <IconButton label="Nueva terminal" onClick={() => createTab()} className="mini">
            <Plus size={14} />
          </IconButton>
        </div>
        <div className="terminal-tab-actions">
          <span className="terminal-cwd" title={repoPath}>
            {repoPath}
          </span>
          <IconButton label="Cerrar panel de terminal" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </div>
      <div className="terminal-bodies">
        {tabs.map((tab) => (
          <TerminalInstance
            key={tab.id}
            id={tab.id}
            repoPath={repoPath}
            active={activeId === tab.id}
            onTitle={(label) => {
              setTabs((current) =>
                current.map((entry) => (entry.id === tab.id ? { ...entry, label } : entry)),
              );
            }}
          />
        ))}
        {tabs.length === 0 && (
          <div className="terminal-empty">
            <button className="primary-button" onClick={() => createTab()}>
              <Plus size={14} /> Nueva terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface TerminalDataPayload {
  id: string;
  data: string;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function TerminalInstance({
  id,
  repoPath,
  active,
  onTitle,
}: {
  id: string;
  repoPath: string;
  active: boolean;
  onTitle: (label: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#0a0d13",
        foreground: "#dbe3ef",
        cursor: "#44e2cd",
        selectionBackground: "#2b3a55",
        black: "#141923",
        red: "#ff6b7d",
        green: "#7bd88f",
        yellow: "#f7c948",
        blue: "#56a8ff",
        magenta: "#c084fc",
        cyan: "#44e2cd",
        white: "#dbe3ef",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    const doFit = () => {
      if (!activeRef.current) return;
      try {
        fit.fit();
        api.terminalResize(id, term.rows, term.cols).catch(() => undefined);
      } catch {
        // El contenedor puede estar oculto durante un cambio de pestaña.
      }
    };

    let disposed = false;
    const dataListener = listen<TerminalDataPayload>("terminal:data", (event) => {
      if (event.payload.id === id) {
        term.write(decodeBase64(event.payload.data));
      }
    });
    const exitListener = listen<{ id: string }>("terminal:exit", (event) => {
      if (event.payload.id === id) {
        term.write("\r\n\x1b[90m[proceso finalizado]\x1b[0m\r\n");
      }
    });
    const inputDisposable = term.onData((data) => {
      api.terminalWrite(id, data).catch((error) => {
        term.write(`\r\n\x1b[31mNo se pudo escribir en la terminal: ${String(error)}\x1b[0m\r\n`);
      });
    });

    const fitEvent = () => doFit();
    window.addEventListener("leviathan:terminal-fit", fitEvent);
    const observer = new ResizeObserver(() => {
      if (activeRef.current) window.requestAnimationFrame(doFit);
    });
    observer.observe(container);

    window.requestAnimationFrame(async () => {
      if (disposed) return;
      doFit();
      try {
        const shell = await api.spawnTerminal(repoPath, id, term.rows || 24, term.cols || 80);
        const label = shell.replace(/\\/g, "/").split("/").pop() || "Terminal";
        onTitle(label);
        doFit();
      } catch (error) {
        const message = error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
        term.write(`\x1b[31m${message}\x1b[0m\r\n`);
      }
    });

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("leviathan:terminal-fit", fitEvent);
      inputDisposable.dispose();
      dataListener.then((unlisten) => unlisten()).catch(() => undefined);
      exitListener.then((unlisten) => unlisten()).catch(() => undefined);
      api.terminalClose(id).catch(() => undefined);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // El ciclo de vida de la terminal está atado a su id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, repoPath]);

  useEffect(() => {
    if (!active) return;
    window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term) api.terminalResize(id, term.rows, term.cols).catch(() => undefined);
        term?.focus();
      } catch {
        // Ignorar mientras el panel se está mostrando.
      }
    });
  }, [active, id]);

  return <div ref={containerRef} className={`terminal-instance ${active ? "is-active" : ""}`} />;
}

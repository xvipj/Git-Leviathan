import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Archive,
  ArchiveRestore,
  ChevronDown,
  CloudDownload,
  GitBranch,
  Moon,
  Plus,
  Redo2,
  Sun,
  Terminal,
  Undo2,
  X,
} from "lucide-react";
import type { UndoStatus } from "../lib/types";
import { IconButton } from "./ui";

export interface RepoSessionTab {
  path: string;
  name: string;
}

export type PullMode = "default" | "merge" | "rebase" | "ff-only";
export type BranchAction =
  | "create"
  | "merge"
  | "rebase"
  | "cherry-pick"
  | "revert"
  | "reset"
  | "tag"
  | "conflicts";

interface TopBarProps {
  repos: RepoSessionTab[];
  activePath: string | null;
  onSelectRepo: (path: string) => void;
  onCloseRepo: (path: string) => void;
  onAddRepo: () => void;
  onUndo: () => void;
  onRedo: () => void;
  undoStatus: UndoStatus | null;
  onFetch: () => void;
  onPull: (mode: PullMode) => void;
  onPush: (options: { setUpstream?: boolean; force?: boolean }) => void;
  onBranchAction: (action: BranchAction) => void;
  onStashAction: (action: "create" | "create-untracked" | "pop-latest") => void;
  onPop: () => void;
  onToggleTerminal: () => void;
  terminalOpen: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  hasRepo: boolean;
  hasSelection: boolean;
  operationInProgress: boolean;
}

export function TopBar({
  repos,
  activePath,
  onSelectRepo,
  onCloseRepo,
  onAddRepo,
  onUndo,
  onRedo,
  undoStatus,
  onFetch,
  onPull,
  onPush,
  onBranchAction,
  onStashAction,
  onPop,
  onToggleTerminal,
  terminalOpen,
  theme,
  onToggleTheme,
  hasRepo,
  hasSelection,
  operationInProgress,
}: TopBarProps) {
  const [menu, setMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const toggle = (name: string) => setMenu((current) => (current === name ? null : name));
  const pick = (fn: () => void) => {
    setMenu(null);
    fn();
  };

  return (
    <header className="topbar" ref={barRef}>
      <div className="brand">
        <img src="/logo.png" alt="" className="brand-mark" />
        <span>Leviathan</span>
      </div>

      <div className="repo-tabs">
        {repos.map((repo) => (
          <div
            key={repo.path}
            className={`repo-tab ${activePath === repo.path ? "is-active" : ""}`}
            title={repo.path}
          >
            <button className="repo-tab-main" onClick={() => onSelectRepo(repo.path)}>
              <span className="repo-dot" />
              <span className="repo-tab-name">{repo.name}</span>
            </button>
            <button
              className="repo-tab-close"
              onClick={() => onCloseRepo(repo.path)}
              title="Cerrar pestaña"
              aria-label="Cerrar pestaña"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="new-tab" onClick={onAddRepo} title="Abrir, clonar o inicializar repositorio">
          <Plus size={15} />
        </button>
      </div>

      <div className="top-actions">
        <IconButton
          label={undoStatus?.undoLabel ?? "Deshacer"}
          onClick={onUndo}
          disabled={!hasRepo || !undoStatus?.canUndo || operationInProgress}
        >
          <Undo2 size={16} />
        </IconButton>
        <IconButton
          label={undoStatus?.redoLabel ?? "Rehacer"}
          onClick={onRedo}
          disabled={!hasRepo || !undoStatus?.canRedo || operationInProgress}
        >
          <Redo2 size={16} />
        </IconButton>

        <div className="action-divider" />

        <IconButton label="Fetch de todos los remotos" onClick={onFetch} disabled={!hasRepo || operationInProgress}>
          <CloudDownload size={16} />
        </IconButton>

        <div className="split-button">
          <button className="action-button" onClick={() => onPull("default")} disabled={!hasRepo || operationInProgress}>
            <ArrowDownToLine size={15} />
            <span>Pull</span>
          </button>
          <button
            className="split-arrow"
            onClick={() => toggle("pull")}
            disabled={!hasRepo || operationInProgress}
            aria-label="Opciones de pull"
          >
            <ChevronDown size={12} />
          </button>
          {menu === "pull" && (
            <Menu>
              <MenuItem onClick={() => pick(() => onPull("default"))}>Pull (configuración de Git)</MenuItem>
              <MenuItem onClick={() => pick(() => onPull("merge"))}>Pull con merge</MenuItem>
              <MenuItem onClick={() => pick(() => onPull("rebase"))}>Pull con rebase</MenuItem>
              <MenuItem onClick={() => pick(() => onPull("ff-only"))}>Pull solo fast-forward</MenuItem>
            </Menu>
          )}
        </div>

        <div className="split-button">
          <button className="action-button" onClick={() => onPush({})} disabled={!hasRepo || operationInProgress}>
            <ArrowUpFromLine size={15} />
            <span>Push</span>
          </button>
          <button
            className="split-arrow"
            onClick={() => toggle("push")}
            disabled={!hasRepo || operationInProgress}
            aria-label="Opciones de push"
          >
            <ChevronDown size={12} />
          </button>
          {menu === "push" && (
            <Menu>
              <MenuItem onClick={() => pick(() => onPush({}))}>Push</MenuItem>
              <MenuItem onClick={() => pick(() => onPush({ setUpstream: true }))}>Push y establecer upstream</MenuItem>
              <MenuItem danger onClick={() => pick(() => onPush({ force: true }))}>
                Force push con lease…
              </MenuItem>
            </Menu>
          )}
        </div>

        <div className="split-button">
          <button
            className="action-button"
            onClick={() => onBranchAction("create")}
            disabled={!hasRepo || operationInProgress}
          >
            <GitBranch size={15} />
            <span>Branch</span>
          </button>
          <button
            className="split-arrow"
            onClick={() => toggle("branch")}
            disabled={!hasRepo || operationInProgress}
            aria-label="Acciones de ramas"
          >
            <ChevronDown size={12} />
          </button>
          {menu === "branch" && (
            <Menu>
              <MenuItem onClick={() => pick(() => onBranchAction("create"))}>Nueva rama…</MenuItem>
              <MenuItem onClick={() => pick(() => onBranchAction("merge"))}>Merge…</MenuItem>
              <MenuItem onClick={() => pick(() => onBranchAction("rebase"))}>Rebase…</MenuItem>
              <MenuSeparator />
              <MenuItem disabled={!hasSelection} onClick={() => pick(() => onBranchAction("cherry-pick"))}>
                Cherry-pick del commit seleccionado
              </MenuItem>
              <MenuItem disabled={!hasSelection} onClick={() => pick(() => onBranchAction("revert"))}>
                Revertir commit seleccionado
              </MenuItem>
              <MenuItem disabled={!hasSelection} onClick={() => pick(() => onBranchAction("reset"))}>
                Reset a un commit…
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => pick(() => onBranchAction("tag"))}>Crear etiqueta…</MenuItem>
              <MenuItem onClick={() => pick(() => onBranchAction("conflicts"))}>Resolver conflictos…</MenuItem>
            </Menu>
          )}
        </div>

        <div className="split-button">
          <button
            className="action-button"
            onClick={() => onStashAction("create")}
            disabled={!hasRepo || operationInProgress}
          >
            <Archive size={15} />
            <span>Stash</span>
          </button>
          <button
            className="split-arrow"
            onClick={() => toggle("stash")}
            disabled={!hasRepo || operationInProgress}
            aria-label="Opciones de stash"
          >
            <ChevronDown size={12} />
          </button>
          {menu === "stash" && (
            <Menu>
              <MenuItem onClick={() => pick(() => onStashAction("create"))}>Guardar cambios…</MenuItem>
              <MenuItem onClick={() => pick(() => onStashAction("create-untracked"))}>
                Guardar incluyendo no rastreados…
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => pick(() => onStashAction("pop-latest"))}>Pop del último stash</MenuItem>
            </Menu>
          )}
        </div>

        <button className="action-button compact" onClick={onPop} disabled={!hasRepo || operationInProgress}>
          <ArchiveRestore size={15} />
          <span>Pop</span>
        </button>

        <IconButton
          label="Terminal integrada (Ctrl+`)"
          onClick={onToggleTerminal}
          active={terminalOpen}
          disabled={!hasRepo}
        >
          <Terminal size={16} />
        </IconButton>

        <IconButton label={theme === "dark" ? "Tema claro" : "Tema oscuro"} onClick={onToggleTheme}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
      </div>
    </header>
  );
}

function Menu({ children }: { children: ReactNode }) {
  return <div className="menu">{children}</div>;
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`menu-item ${danger ? "is-danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div className="menu-separator" />;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  Check,
  CloudDownload,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
  User,
} from "lucide-react";

import { api, errorText, newOperationId } from "./lib/api";
import type {
  ActionOutcome,
  AppBootstrap,
  BlameLine,
  Branch,
  CommitDetails,
  CommitEntry,
  ConflictSides,
  DiffResult,
  FileStatus,
  HistoryFilter,
  HistoryKind,
  HistoryPage,
  Remote,
  RepoInfo,
  RepoState,
  Stash,
  StatusInfo,
  Tag,
  UndoStatus,
  Worktree,
} from "./lib/types";

import { TopBar, type BranchAction, type PullMode, type RepoSessionTab } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { GraphView, type ScrollTarget } from "./components/GraphView";
import { RightPanel, type DiffMode } from "./components/RightPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import {
  ConfirmDialog,
  ErrorDialog,
  MergeDialog,
  OperationOverlay,
  RebaseDialog,
  RepoDialog,
  ResetDialog,
  TextFormDialog,
  type FormCheck,
  type FormField,
  type OperationState,
} from "./components/Dialogs";
import { BlameDialog, FileHistoryDialog } from "./components/HistoryDialogs";
import { Modal, ToastHost, Warning, type ToastItem } from "./components/ui";
import type { FileEntry } from "./components/FileList";

const PAGE_SIZE = 300;

type Theme = "dark" | "light";

interface LastError {
  title: string;
  message: string;
  detail?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  commit: CommitEntry;
}

type DialogState =
  | { type: "repo"; tab: "open" | "init" | "clone" }
  | { type: "create-branch"; startPoint: string }
  | { type: "rename-branch"; branch: Branch }
  | { type: "delete-branch"; branch: Branch }
  | { type: "delete-tag"; tag: Tag }
  | { type: "tag"; rev: string; revLabel: string }
  | { type: "merge" }
  | { type: "rebase" }
  | { type: "reset"; rev: string; shortHash: string }
  | { type: "conflicts" }
  | { type: "stash"; includeUntracked: boolean }
  | { type: "drop-stash"; stash: Stash }
  | { type: "add-remote" }
  | { type: "remove-remote"; remote: Remote }
  | { type: "discard-file"; file: FileStatus }
  | { type: "discard-all" }
  | { type: "force-push" }
  | { type: "undo" }
  | { type: "redo" };

interface BlameDialogState {
  path: string;
  lines: BlameLine[];
  loading: boolean;
}

interface FileHistoryState {
  path: string;
  commits: CommitEntry[];
  loading: boolean;
}

interface ProgressPayload {
  operationId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

function normalizePath(path: string | null | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function shortOrigin(origin: string | null | undefined): string {
  if (!origin) return "";
  return origin.replace(/^file:/i, "").replace(/^command line:/i, "línea de comandos:");
}

function isRepoState(value: unknown): value is RepoState {
  return Boolean(
    value &&
      typeof value === "object" &&
      "info" in value &&
      "status" in value,
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem("leviathan-theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [boot, setBoot] = useState<AppBootstrap | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState<LastError | null>(null);

  const [repos, setRepos] = useState<RepoSessionTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [repoState, setRepoState] = useState<RepoState | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [undoStatus, setUndoStatus] = useState<UndoStatus | null>(null);

  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<HistoryFilter | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchKind, setSearchKind] = useState<HistoryKind>("message");
  const [highlightName, setHighlightName] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);

  const [wipSelected, setWipSelected] = useState(true);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffMode, setDiffMode] = useState<DiffMode>("unstaged");
  const [conflict, setConflict] = useState<ConflictSides | null>(null);
  const [conflictLoading, setConflictLoading] = useState(false);

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const [sign, setSign] = useState(false);
  const [committing, setCommitting] = useState(false);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [error, setError] = useState<LastError | null>(null);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [blameDialog, setBlameDialog] = useState<BlameDialogState | null>(null);
  const [fileHistory, setFileHistory] = useState<FileHistoryState | null>(null);

  const activePathRef = useRef<string | null>(null);
  const commitsRef = useRef<CommitEntry[]>([]);
  const hasMoreRef = useRef(false);
  const filterRef = useRef<HistoryFilter | null>(null);
  const historyLoadingRef = useRef(false);
  const selectedHashRef = useRef<string | null>(null);
  const selectedFileRef = useRef<FileEntry | null>(null);
  const diffModeRef = useRef<DiffMode>("unstaged");
  const wipSelectedRef = useRef(true);
  const headRef = useRef<string | null>(null);
  const detailsToken = useRef(0);
  const diffToken = useRef(0);
  const conflictToken = useRef(0);
  const bootedRef = useRef(false);
  const toastTimers = useRef<number[]>([]);
  const refreshErrorShown = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("leviathan-theme", theme);
    } catch {
      // El tema solo se recuerda cuando el navegador lo permite.
    }
  }, [theme]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);
  useEffect(() => {
    commitsRef.current = commits;
  }, [commits]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    selectedHashRef.current = selectedHash;
  }, [selectedHash]);
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);
  useEffect(() => {
    diffModeRef.current = diffMode;
  }, [diffMode]);
  useEffect(() => {
    wipSelectedRef.current = wipSelected;
  }, [wipSelected]);

  const fail = useCallback((value: unknown, title = "Git devolvió un error") => {
    const parsed = errorText(value);
    setError({ title, message: parsed.message, detail: parsed.detail });
  }, []);

  const notify = useCallback(
    (kind: ToastItem["kind"], message: string, detail?: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-4), { id, kind, message, detail }]);
      const timer = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
        toastTimers.current = toastTimers.current.filter((value) => value !== timer);
      }, 6500);
      toastTimers.current.push(timer);
    },
    [],
  );

  useEffect(() => {
    return () => {
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  async function loadBootstrap() {
    setBootLoading(true);
    setBootError(null);
    try {
      const result = await api.bootstrap();
      setBoot(result);
      setRecents(result.recents);
    } catch (value) {
      setBootError({ title: "No se pudo iniciar la aplicación", ...errorText(value) });
    } finally {
      setBootLoading(false);
    }
  }

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void loadBootstrap();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ProgressPayload>("git:progress", (event) => {
      setOperation((current) => {
        if (!current || current.id !== event.payload.operationId) return current;
        const nextLog = `${current.log}${event.payload.chunk}`;
        return {
          ...current,
          log: nextLog.length > 16000 ? nextLog.slice(-16000) : nextLog,
        };
      });
    })
      .then((value) => {
        unlisten = value;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && event.key === "`") {
        event.preventDefault();
        if (activePathRef.current) setTerminalOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  const refreshAll = useCallback(async (path: string): Promise<RepoState | null> => {
    const [state, branchList, tagList, stashList, worktreeList, remoteList, undo] =
      await Promise.all([
        api.refreshRepo(path).catch(() => null),
        api.listBranches(path).catch(() => null),
        api.listTags(path).catch(() => null),
        api.listStashes(path).catch(() => null),
        api.listWorktrees(path).catch(() => null),
        api.listRemotes(path).catch(() => null),
        api.getUndoStatus(path).catch(() => null),
      ]);
    if (normalizePath(activePathRef.current) !== normalizePath(path)) return null;
    if (state) {
      setRepoState(state);
      headRef.current = state.info.head;
      refreshErrorShown.current = false;
    } else if (!refreshErrorShown.current) {
      refreshErrorShown.current = true;
      notify("error", "No se pudo refrescar el repositorio", "Comprueba que la carpeta siga existiendo.");
    }
    if (branchList) setBranches(branchList);
    if (tagList) setTags(tagList);
    if (stashList) setStashes(stashList);
    if (worktreeList) setWorktrees(worktreeList);
    if (remoteList) setRemotes(remoteList);
    if (undo) setUndoStatus(undo);
    return state;
  }, [notify]);

  const reloadHistory = useCallback(
    async (
      path: string,
      filter: HistoryFilter | null,
      options?: { silent?: boolean },
    ): Promise<HistoryPage | null> => {
      if (normalizePath(activePathRef.current) !== normalizePath(path)) return null;
      historyLoadingRef.current = true;
      setHistoryLoading(true);
      try {
        const page = await api.getHistory(path, 0, PAGE_SIZE, filter);
        if (normalizePath(activePathRef.current) !== normalizePath(path)) return null;
        filterRef.current = filter;
        commitsRef.current = page.commits;
        hasMoreRef.current = page.hasMore;
        setActiveFilter(filter);
        setCommits(page.commits);
        setHasMore(page.hasMore);
        return page;
      } catch (value) {
        if (!options?.silent) fail(value, "No se pudo cargar el historial");
        return null;
      } finally {
        historyLoadingRef.current = false;
        if (normalizePath(activePathRef.current) === normalizePath(path)) {
          setHistoryLoading(false);
        }
      }
    },
    [fail],
  );

  async function syncRecents() {
    try {
      setRecents(await api.listRecents());
    } catch {
      // La lista de recientes es auxiliar.
    }
  }

  function resetSelection() {
    selectedHashRef.current = null;
    setSelectedHash(null);
    wipSelectedRef.current = true;
    setWipSelected(true);
    setDetails(null);
    setDetailsLoading(false);
    setSelectedFile(null);
    selectedFileRef.current = null;
    setDiff(null);
    setDiffLoading(false);
    setConflict(null);
    setConflictLoading(false);
    setDiffMode("unstaged");
    setContextMenu(null);
  }

  function clearWorkspace() {
    activePathRef.current = null;
    setActivePath(null);
    setRepoState(null);
    headRef.current = null;
    setBranches([]);
    setTags([]);
    setStashes([]);
    setWorktrees([]);
    setRemotes([]);
    setUndoStatus(null);
    commitsRef.current = [];
    hasMoreRef.current = false;
    filterRef.current = null;
    setCommits([]);
    setHasMore(false);
    setHistoryLoading(false);
    setActiveFilter(null);
    setHighlightName(null);
    setScrollTarget(null);
    resetSelection();
    setTerminalOpen(false);
  }

  async function activateRepo(state: RepoState) {
    const path = state.info.path;
    activePathRef.current = path;
    setActivePath(path);
    setRepoState(state);
    headRef.current = state.info.head;
    setRepos((current) =>
      current.some((repo) => normalizePath(repo.path) === normalizePath(path))
        ? current
        : [...current, { path, name: state.info.name }],
    );
    setBranches([]);
    setTags([]);
    setStashes([]);
    setWorktrees([]);
    setRemotes([]);
    setUndoStatus(null);
    commitsRef.current = [];
    hasMoreRef.current = false;
    filterRef.current = null;
    setCommits([]);
    setHasMore(false);
    setActiveFilter(null);
    setHighlightName(null);
    setScrollTarget(null);
    setSearchQuery("");
    setSummary("");
    setDescription("");
    setAmend(false);
    setSign(false);
    resetSelection();
    setRepoLoading(false);
    void refreshAll(path);
    void reloadHistory(path, null);
  }

  async function openRepo(path: string): Promise<boolean> {
    setRepoLoading(true);
    try {
      const state = await api.openRepository(path);
      await activateRepo(state);
      await syncRecents();
      return true;
    } catch (value) {
      fail(value, "No se pudo abrir el repositorio");
      setRepoLoading(false);
      return false;
    }
  }

  async function switchRepo(path: string) {
    if (normalizePath(path) === normalizePath(activePathRef.current)) return;
    await openRepo(path);
  }

  async function initRepo(path: string): Promise<boolean> {
    setRepoLoading(true);
    try {
      const state = await api.initRepository(path);
      await activateRepo(state);
      await syncRecents();
      return true;
    } catch (value) {
      fail(value, "No se pudo inicializar el repositorio");
      setRepoLoading(false);
      return false;
    }
  }

  async function finishMutation(path: string, reload = true) {
    await refreshAll(path);
    if (reload) await reloadHistory(path, filterRef.current);
  }

  const runStreaming = useCallback(
    async (title: string, task: (id: string) => Promise<unknown>): Promise<unknown | null> => {
      const id = newOperationId("op");
      setOperation({ id, title, log: "", cancelling: false });
      try {
        return await task(id);
      } catch (value) {
        const parsed = errorText(value);
        if (/cancelad/i.test(parsed.message)) {
          notify("info", "Operación cancelada");
        } else {
          fail(value, title);
        }
        return null;
      } finally {
        setOperation((current) => (current && current.id === id ? null : current));
      }
    },
    [fail, notify],
  );

  async function cancelOperation() {
    if (!operation) return;
    const id = operation.id;
    setOperation((current) => (current ? { ...current, cancelling: true } : current));
    try {
      await api.cancelOperation(id);
    } catch (value) {
      fail(value, "No se pudo cancelar la operación");
    }
  }

  function showWip() {
    wipSelectedRef.current = true;
    setWipSelected(true);
    selectedHashRef.current = null;
    setSelectedHash(null);
    setDetails(null);
    setDetailsLoading(false);
    setSelectedFile(null);
    selectedFileRef.current = null;
    setDiff(null);
    setDiffLoading(false);
    setConflict(null);
    setConflictLoading(false);
    setDiffMode("unstaged");
  }

  function selectCommit(commit: CommitEntry) {
    wipSelectedRef.current = false;
    setWipSelected(false);
    selectedHashRef.current = commit.hash;
    setSelectedHash(commit.hash);
    setSelectedFile(null);
    selectedFileRef.current = null;
    setDiff(null);
    setDiffLoading(false);
    setConflict(null);
    setConflictLoading(false);
    setDiffMode("commit");
    void loadDetails(commit.hash, true);
  }

  async function loadDetails(hash: string, autoSelectFile: boolean) {
    const path = activePathRef.current;
    if (!path) return;
    const token = ++detailsToken.current;
    setDetailsLoading(true);
    setDetails(null);
    try {
      const result = await api.getCommitDetails(path, hash);
      if (
        token !== detailsToken.current ||
        selectedHashRef.current !== hash ||
        normalizePath(activePathRef.current) !== normalizePath(path)
      ) {
        return;
      }
      setDetails(result);
      if (autoSelectFile && result.files.length > 0) {
        void loadCommitFile(path, hash, result.files[0].path, result.files[0].oldPath, result.files[0].status);
      }
    } catch (value) {
      if (token === detailsToken.current) fail(value, "No se pudo cargar el commit");
    } finally {
      if (token === detailsToken.current) setDetailsLoading(false);
    }
  }

  async function loadDiff(path: string, entry: FileEntry, mode: DiffMode) {
    const token = ++diffToken.current;
    setDiffLoading(true);
    setDiff(null);
    try {
      const result = await api.getFileDiff(
        path,
        entry.path,
        mode,
        mode === "commit" ? selectedHashRef.current : null,
        entry.oldPath ?? null,
        mode !== "commit" && Boolean(entry.untracked),
        3,
      );
      if (token === diffToken.current && normalizePath(activePathRef.current) === normalizePath(path)) {
        setDiff(result);
      }
    } catch (value) {
      if (token === diffToken.current) fail(value, "No se pudo cargar el diff");
    } finally {
      if (token === diffToken.current) setDiffLoading(false);
    }
  }

  async function loadCommitFile(
    path: string,
    hash: string,
    filePath: string,
    oldPath: string | null,
    status: string,
  ) {
    const entry: FileEntry = { path: filePath, oldPath, status };
    setSelectedFile(entry);
    selectedFileRef.current = entry;
    setDiffMode("commit");
    diffModeRef.current = "commit";
    setConflict(null);
    setConflictLoading(false);
    await loadDiff(path, entry, "commit");
  }

  async function openWipFile(file: FileStatus, staged: boolean) {
    const path = activePathRef.current;
    if (!path) return;
    const entry: FileEntry = {
      path: file.path,
      oldPath: file.origPath ?? null,
      status: file.status,
      untracked: file.untracked,
      conflicted: file.conflicted,
    };
    setSelectedFile(entry);
    selectedFileRef.current = entry;
    const mode: DiffMode = staged ? "staged" : "unstaged";
    setDiffMode(mode);
    diffModeRef.current = mode;
    setDiff(null);
    setConflict(null);
    if (file.conflicted) {
      await loadConflict(file, path);
      return;
    }
    setConflictLoading(false);
    await loadDiff(path, entry, mode);
  }

  async function loadConflict(file: FileStatus, path = activePathRef.current) {
    if (!path) return;
    const token = ++conflictToken.current;
    setConflictLoading(true);
    setConflict(null);
    try {
      const result = await api.getConflictSides(path, file.path);
      if (token === conflictToken.current && normalizePath(activePathRef.current) === normalizePath(path)) {
        setConflict(result);
      }
    } catch (value) {
      if (token === conflictToken.current) fail(value, "No se pudo cargar el conflicto");
    } finally {
      if (token === conflictToken.current) setConflictLoading(false);
    }
  }

  async function labelDiff(path: string, entry: FileEntry | null, mode: DiffMode) {
    if (!entry || entry.conflicted) return;
    await loadDiff(path, entry, mode);
  }

  async function stagePaths(paths: string[]) {
    const path = activePathRef.current;
    if (!path || paths.length === 0) return;
    try {
      await api.stagePaths(path, paths);
      await refreshAll(path);
      if (wipSelectedRef.current && selectedFileRef.current && !selectedFileRef.current.conflicted) {
        const entry = { ...selectedFileRef.current, untracked: false };
        setSelectedFile(entry);
        selectedFileRef.current = entry;
        setDiffMode("staged");
        diffModeRef.current = "staged";
        await labelDiff(path, entry, "staged");
      }
    } catch (value) {
      fail(value, "No se pudieron preparar los archivos");
    }
  }

  async function unstagePaths(paths: string[]) {
    const path = activePathRef.current;
    if (!path || paths.length === 0) return;
    try {
      await api.unstagePaths(path, paths);
      await refreshAll(path);
      if (wipSelectedRef.current && selectedFileRef.current && !selectedFileRef.current.conflicted) {
        const entry = selectedFileRef.current;
        setDiffMode("unstaged");
        diffModeRef.current = "unstaged";
        await labelDiff(path, entry, "unstaged");
      }
    } catch (value) {
      fail(value, "No se pudieron quitar los archivos del área de preparación");
    }
  }

  async function stageAll() {
    const path = activePathRef.current;
    if (!path) return;
    try {
      await api.stageAll(path);
      await refreshAll(path);
      if (wipSelectedRef.current && selectedFileRef.current && !selectedFileRef.current.conflicted) {
        const entry = { ...selectedFileRef.current, untracked: false };
        setSelectedFile(entry);
        selectedFileRef.current = entry;
        setDiffMode("staged");
        diffModeRef.current = "staged";
        await labelDiff(path, entry, "staged");
      }
    } catch (value) {
      fail(value, "No se pudieron preparar los archivos");
    }
  }

  async function unstageAll() {
    const path = activePathRef.current;
    if (!path) return;
    try {
      await api.unstageAll(path);
      await refreshAll(path);
      if (wipSelectedRef.current && selectedFileRef.current && !selectedFileRef.current.conflicted) {
        const entry = selectedFileRef.current;
        setDiffMode("unstaged");
        diffModeRef.current = "unstaged";
        await labelDiff(path, entry, "unstaged");
      }
    } catch (value) {
      fail(value, "No se pudo vaciar el área de preparación");
    }
  }

  async function discardFile(file: FileStatus) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.discardPaths(path, [file.path], true);
      await refreshAll(path);
      if (selectedFileRef.current?.path === file.path) {
        setSelectedFile(null);
        selectedFileRef.current = null;
        setDiff(null);
        setConflict(null);
        setDiffMode("unstaged");
      }
      notify("success", "Cambios descartados", file.path);
    } catch (value) {
      fail(value, "No se pudieron descartar los cambios");
    }
  }

  async function discardAll() {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.discardAll(path, true);
      await refreshAll(path);
      setSelectedFile(null);
      selectedFileRef.current = null;
      setDiff(null);
      setConflict(null);
      notify("success", "Cambios descartados del árbol de trabajo");
    } catch (value) {
      fail(value, "No se pudieron descartar los cambios");
    }
  }

  async function applyPatch(patch: string, cached: boolean, reverse: boolean) {
    const path = activePathRef.current;
    if (!path) return;
    try {
      await api.applyPatch(path, patch, cached, reverse);
      await refreshAll(path);
      if (selectedFileRef.current && diffModeRef.current !== "commit") {
        await labelDiff(path, selectedFileRef.current, diffModeRef.current);
      }
    } catch (value) {
      fail(value, "No se pudo aplicar el parche");
    }
  }

  async function commitChanges() {
    const path = activePathRef.current;
    if (!path) return;
    setCommitting(true);
    try {
      await api.commitChanges(path, [summary.trim(), description.trim()].filter(Boolean).join("\n\n"), amend, sign);
      setSummary("");
      setDescription("");
      setAmend(false);
      setSign(false);
      await refreshAll(path);
      await reloadHistory(path, filterRef.current);
      showWip();
      notify("success", amend ? "Commit enmendado" : "Commit creado");
    } catch (value) {
      fail(value, "No se pudo crear el commit");
    } finally {
      setCommitting(false);
    }
  }

  async function checkoutBranch(branch: Branch) {
    const path = activePathRef.current;
    if (!path) return;
    const name = branch.isRemote ? `${branch.remote ?? ""}/${branch.name}` : branch.name;
    try {
      await api.checkoutBranch(path, name, branch.isRemote);
      await finishMutation(path);
      showWip();
      notify("success", `Checkout a ${branch.name}`);
    } catch (value) {
      fail(value, "No se pudo hacer checkout");
    }
  }

  async function createBranch(
    name: string,
    startPoint: string | null,
    checkout: boolean,
  ) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.createBranch(path, name, startPoint, checkout);
      await finishMutation(path);
      if (checkout) showWip();
      notify("success", `Rama ${name} creada`);
    } catch (value) {
      fail(value, "No se pudo crear la rama");
    }
  }

  async function renameBranch(branch: Branch, newName: string) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.renameBranch(path, branch.name, newName);
      await finishMutation(path);
      notify("success", `Rama renombrada a ${newName}`);
    } catch (value) {
      fail(value, "No se pudo renombrar la rama");
    }
  }

  async function deleteBranch(branch: Branch, force: boolean) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.deleteBranch(path, branch.name, force, true);
      await finishMutation(path);
      notify("success", `Rama ${branch.name} borrada`);
    } catch (value) {
      fail(value, "No se pudo borrar la rama");
    }
  }

  async function createTag(name: string, rev: string, message: string | null) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.createTag(path, name, rev, message);
      await finishMutation(path);
      notify("success", `Etiqueta ${name} creada`);
    } catch (value) {
      fail(value, "No se pudo crear la etiqueta");
    }
  }

  async function deleteTag(tag: Tag) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.deleteTag(path, tag.name);
      await finishMutation(path);
      notify("success", `Etiqueta ${tag.name} borrada`);
    } catch (value) {
      fail(value, "No se pudo borrar la etiqueta");
    }
  }

  async function createStash(message: string | null, includeUntracked: boolean) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.createStash(path, message, includeUntracked);
      await finishMutation(path);
      showWip();
      notify("success", "Cambios guardados en stash");
    } catch (value) {
      fail(value, "No se pudo guardar el stash");
    }
  }

  async function applyStash(stash: Stash, pop: boolean) {
    const path = activePathRef.current;
    if (!path) return;
    try {
      await api.applyStash(path, stash.selector, pop);
      await finishMutation(path, false);
      showWip();
      notify("success", pop ? "Stash aplicado y eliminado" : "Stash aplicado");
    } catch (value) {
      fail(value, "No se pudo aplicar el stash");
    }
  }

  async function dropStash(stash: Stash) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.dropStash(path, stash.selector, true);
      await finishMutation(path, false);
      notify("success", "Stash eliminado");
    } catch (value) {
      fail(value, "No se pudo borrar el stash");
    }
  }

  async function addRemote(name: string, url: string) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.addRemote(path, name, url);
      await finishMutation(path, false);
      notify("success", `Remoto ${name} agregado`);
    } catch (value) {
      fail(value, "No se pudo agregar el remoto");
    }
  }

  async function removeRemote(remote: Remote) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.removeRemote(path, remote.name);
      await finishMutation(path, false);
      notify("success", `Remoto ${remote.name} eliminado`);
    } catch (value) {
      fail(value, "No se pudo eliminar el remoto");
    }
  }

  async function handleMerge(target: string, noFf: boolean, squash: boolean, message: string) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      const outcome = await api.mergeBranch(path, target, noFf, squash, message.trim() || null);
      await finishMutation(path);
      if (outcome.conflicts) {
        showWip();
        notify("error", "Merge con conflictos", "Resuelve los archivos en el panel de cambios sin confirmar.");
      } else if (squash) {
        showWip();
        notify("success", "Merge squash preparado", "Los cambios están en el área de preparación.");
      } else {
        notify("success", "Merge completado");
      }
    } catch (value) {
      fail(value, "No se pudo hacer el merge");
      await refreshAll(path);
    }
  }

  async function handleRebase(target: string) {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      const outcome = await api.rebaseOnto(path, target);
      await finishMutation(path);
      if (outcome.conflicts) {
        showWip();
        notify("error", "Rebase con conflictos", "Resuelve los conflictos y continúa desde tu terminal, o aborta el rebase.");
      } else {
        notify("success", "Rebase completado");
      }
    } catch (value) {
      fail(value, "No se pudo hacer el rebase");
      await refreshAll(path);
    }
  }

  async function handleReset(rev: string, mode: "soft" | "mixed" | "hard") {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      await api.resetToCommit(path, rev, mode, mode === "hard");
      await finishMutation(path);
      showWip();
      notify("success", `Reset --${mode} completado`);
    } catch (value) {
      fail(value, "No se pudo hacer el reset");
    }
  }

  async function handleOutcome(label: string, task: () => Promise<ActionOutcome>) {
    const path = activePathRef.current;
    if (!path) return;
    try {
      const outcome = await task();
      await finishMutation(path);
      if (outcome.conflicts) {
        showWip();
        notify("error", `${label} con conflictos`, "Resuelve los conflictos en el panel de cambios sin confirmar.");
      } else {
        notify("success", `${label} completado`);
      }
    } catch (value) {
      fail(value, `No se pudo completar ${label.toLowerCase()}`);
      await refreshAll(path);
    }
  }

  async function abortOperation(kind: "merge" | "rebase" | "cherry-pick" | "revert") {
    const path = activePathRef.current;
    if (!path) return;
    try {
      if (kind === "merge") await api.abortMerge(path);
      else if (kind === "rebase") await api.abortRebase(path);
      else if (kind === "cherry-pick") await api.abortCherryPick(path);
      else await api.abortRevert(path);
      await finishMutation(path, false);
      showWip();
      notify("success", "Operación abortada");
    } catch (value) {
      fail(value, "No se pudo abortar la operación");
    }
  }

  async function resolveSide(file: FileStatus, side: "ours" | "theirs") {
    const path = activePathRef.current;
    if (!path) return;
    try {
      await api.resolveWithSide(path, file.path, side);
      await refreshAll(path);
      setConflict(null);
      setSelectedFile(null);
      selectedFileRef.current = null;
      setDiff(null);
      notify("success", "Conflicto resuelto", `${file.path} · lado ${side === "ours" ? "nuestro" : "suyo"}`);
    } catch (value) {
      fail(value, "No se pudo resolver el conflicto");
    }
  }

  async function markResolved(file: FileStatus) {
    const path = activePathRef.current;
    if (!path) return;
    try {
      await api.markResolved(path, file.path);
      await refreshAll(path);
      setConflict(null);
      setSelectedFile(null);
      selectedFileRef.current = null;
      setDiff(null);
      notify("success", "Archivo marcado como resuelto", file.path);
    } catch (value) {
      fail(value, "No se pudo marcar el archivo como resuelto");
    }
  }

  async function handleFetch(remote?: string) {
    const path = activePathRef.current;
    if (!path) return;
    const result = await runStreaming(
      remote ? `Fetch de ${remote}` : "Fetch de todos los remotos",
      (id) => api.fetchRemote(path, remote ?? null, false, id),
    );
    await refreshAll(path);
    if (result) notify("success", remote ? `Fetch de ${remote} completado` : "Fetch completado");
  }

  async function afterStreaming(path: string) {
    await refreshAll(path);
    await reloadHistory(path, filterRef.current);
  }

  async function handlePull(mode: PullMode) {
    const path = activePathRef.current;
    if (!path) return;
    const result = await runStreaming(
      mode === "default" ? "Pull" : `Pull (${mode === "ff-only" ? "solo fast-forward" : mode})`,
      (id) => api.pullRemote(path, null, mode, id),
    );
    await afterStreaming(path);
    if (result) notify("success", "Pull completado");
  }

  async function handlePush(options: { setUpstream?: boolean; force?: boolean }, confirmed = false) {
    const path = activePathRef.current;
    if (!path) return;
    const setUpstream = Boolean(options.setUpstream);
    const force = Boolean(options.force);
    const remote = setUpstream ? remotes[0]?.name ?? null : null;
    if (setUpstream && !remote) {
      notify("error", "No hay remotos configurados", "Agrega un remoto antes de establecer el upstream.");
      return;
    }
    const result = await runStreaming(force ? "Force push con lease" : "Push", (id) =>
      api.pushRemote(path, remote, setUpstream, force, force ? confirmed : false, id),
    );
    await refreshAll(path);
    if (result) notify("success", force ? "Force push completado" : "Push completado");
  }

  async function handleClone(url: string, destination: string) {
    setDialog(null);
    const result = await runStreaming("Clonando repositorio", (id) =>
      api.cloneRepository(url, destination, id),
    );
    const cloned = isRepoState(result) ? result : null;
    if (cloned) {
      await activateRepo(cloned);
      await syncRecents();
      notify("success", "Repositorio clonado", cloned.info.path);
    } else {
      await syncRecents();
    }
  }

  async function handleUndo() {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      const message = await api.undoLast(path);
      await afterStreaming(path);
      showWip();
      notify("success", "Operación deshecha", message);
    } catch (value) {
      fail(value, "No se pudo deshacer");
    }
  }

  async function handleRedo() {
    const path = activePathRef.current;
    if (!path) return;
    setDialog(null);
    try {
      const message = await api.redoLast(path);
      await afterStreaming(path);
      showWip();
      notify("success", "Operación rehecha", message);
    } catch (value) {
      fail(value, "No se pudo rehacer");
    }
  }

  async function loadMore() {
    const path = activePathRef.current;
    if (!path || historyLoadingRef.current || !hasMoreRef.current) return;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    try {
      const page = await api.getHistory(path, commitsRef.current.length, PAGE_SIZE, filterRef.current);
      if (normalizePath(activePathRef.current) !== normalizePath(path)) return;
      const merged = [...commitsRef.current, ...page.commits];
      commitsRef.current = merged;
      hasMoreRef.current = page.hasMore;
      setCommits(merged);
      setHasMore(page.hasMore);
    } catch (value) {
      fail(value, "No se pudo cargar más historial");
    } finally {
      historyLoadingRef.current = false;
      if (normalizePath(activePathRef.current) === normalizePath(path)) {
        setHistoryLoading(false);
      }
    }
  }

  async function refreshView() {
    const path = activePathRef.current;
    if (!path) return;
    await refreshAll(path);
    await reloadHistory(path, filterRef.current);
    const hash = selectedHashRef.current;
    if (hash) {
      if (commitsRef.current.some((commit) => commit.hash === hash)) {
        await loadDetails(hash, false);
      } else {
        showWip();
      }
    }
  }

  function submitSearch() {
    const path = activePathRef.current;
    if (!path) return;
    const query = searchQuery.trim();
    const filter: HistoryFilter | null = query ? { query, kind: searchKind } : null;
    void reloadHistory(path, filter);
  }

  function clearSearch() {
    const path = activePathRef.current;
    if (!path) return;
    setSearchQuery("");
    setActiveFilter(null);
    void reloadHistory(path, null);
  }

  async function jumpToCommit(hash: string) {
    const path = activePathRef.current;
    if (!path) return;
    let found = commitsRef.current.find((commit) => commit.hash === hash);
    if (!found) {
      const page = await reloadHistory(path, null);
      found = page?.commits.find((commit) => commit.hash === hash);
    }
    if (found) {
      selectCommit(found);
      setScrollTarget({ hash, nonce: Date.now() });
      return;
    }
    wipSelectedRef.current = false;
    setWipSelected(false);
    selectedHashRef.current = hash;
    setSelectedHash(hash);
    setSelectedFile(null);
    setDiff(null);
    setDiffMode("commit");
    await loadDetails(hash, true);
    notify("info", "Commit fuera de la página cargada", "Se muestran sus detalles sin desplazar el grafo.");
  }

  async function openBlame(path: string) {
    const repoPath = activePathRef.current;
    if (!repoPath) return;
    setBlameDialog({ path, lines: [], loading: true });
    try {
      const lines = await api.getBlame(repoPath, path);
      setBlameDialog((current) => (current && current.path === path ? { path, lines, loading: false } : current));
    } catch (value) {
      setBlameDialog(null);
      fail(value, "No se pudo ejecutar git blame");
    }
  }

  async function openFileHistory(path: string) {
    const repoPath = activePathRef.current;
    if (!repoPath) return;
    setFileHistory({ path, commits: [], loading: true });
    try {
      const list = await api.getFileHistory(repoPath, path, 100);
      setFileHistory((current) => (current && current.path === path ? { path, commits: list, loading: false } : current));
    } catch (value) {
      setFileHistory(null);
      fail(value, "No se pudo cargar el historial del archivo");
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("success", "Copiado al portapapeles");
    } catch {
      notify("error", "No se pudo copiar", "El portapapeles no está disponible.");
    }
  }

  function closeRepo(path: string) {
    const normalized = normalizePath(path);
    const next = repos.filter((repo) => normalizePath(repo.path) !== normalized);
    setRepos(next);
    if (normalizePath(activePathRef.current) === normalized) {
      if (next.length > 0) {
        void switchRepo(next[next.length - 1].path);
      } else {
        clearWorkspace();
      }
    }
  }

  function handleBranchAction(action: BranchAction) {
    const path = activePathRef.current;
    if (!path) return;
    switch (action) {
      case "create":
        setDialog({ type: "create-branch", startPoint: "" });
        break;
      case "merge":
        setDialog({ type: "merge" });
        break;
      case "rebase":
        setDialog({ type: "rebase" });
        break;
      case "cherry-pick":
        if (selectedHashRef.current) {
          void handleOutcome("Cherry-pick", () => api.cherryPick(path, selectedHashRef.current!));
        } else {
          notify("info", "Selecciona un commit en el grafo");
        }
        break;
      case "revert":
        if (selectedHashRef.current) {
          void handleOutcome("Revert", () => api.revertCommit(path, selectedHashRef.current!));
        } else {
          notify("info", "Selecciona un commit en el grafo");
        }
        break;
      case "reset":
        if (selectedHashRef.current) {
          const commit = commitsRef.current.find((entry) => entry.hash === selectedHashRef.current);
          setDialog({
            type: "reset",
            rev: selectedHashRef.current,
            shortHash: commit?.shortHash ?? selectedHashRef.current.slice(0, 7),
          });
        } else {
          notify("info", "Selecciona un commit en el grafo");
        }
        break;
      case "tag":
        setDialog({
          type: "tag",
          rev: selectedHashRef.current ?? "HEAD",
          revLabel: selectedHashRef.current ? selectedHashRef.current.slice(0, 7) : "HEAD",
        });
        break;
      case "conflicts":
        setDialog({ type: "conflicts" });
        break;
    }
  }

  function handleStashAction(action: "create" | "create-untracked" | "pop-latest") {
    if (action === "create") {
      setDialog({ type: "stash", includeUntracked: false });
      return;
    }
    if (action === "create-untracked") {
      setDialog({ type: "stash", includeUntracked: true });
      return;
    }
    const latest = stashes[0];
    if (!latest) {
      notify("info", "No hay stashes para aplicar");
      return;
    }
    void applyStash(latest, true);
  }

  function openCommitContext(commit: CommitEntry, event: React.MouseEvent) {
    event.preventDefault();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 240),
      y: Math.min(event.clientY, window.innerHeight - 280),
      commit,
    });
  }

  useEffect(() => {
    if (!activePath) return;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    const target = normalizePath(activePath);
    void listen<{ path: string }>("repo:changed", (event) => {
      if (normalizePath(event.payload.path) !== target) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const before = headRef.current;
        const state = await refreshAll(activePath);
        if (state && state.info.head !== before) {
          await reloadHistory(activePath, filterRef.current);
        }
      }, 550);
    })
      .then((value) => {
        unlisten = value;
      })
      .catch(() => undefined);
    return () => {
      if (timer) window.clearTimeout(timer);
      unlisten?.();
    };
  }, [activePath, refreshAll, reloadHistory]);

  const status = repoState?.status ?? null;
  const info = repoState?.info ?? null;
  const hasRepo = Boolean(activePath && repoState);
  const hasSelection = Boolean(selectedHash) && !wipSelected;
  const operationInProgress = Boolean(operation);
  const wipCount = status
    ? status.staged.length + status.unstaged.length + status.conflicted.length
    : 0;
  const currentBranch = info?.branch ?? null;
  const otherBranches = branches.filter((branch) => !branch.isCurrent);

  function renderDialog() {
    if (!dialog) return null;
    switch (dialog.type) {
      case "repo":
        return (
          <RepoDialog
            initialTab={dialog.tab}
            recents={recents}
            onOpen={async (path) => {
              const ok = await openRepo(path);
              if (ok) setDialog(null);
            }}
            onInit={async (path) => {
              const ok = await initRepo(path);
              if (ok) setDialog(null);
            }}
            onClone={(url, destination) => void handleClone(url, destination)}
            onRemoveRecent={async (path) => {
              try {
                setRecents(await api.removeRecent(path));
              } catch (value) {
                fail(value, "No se pudo quitar el reciente");
              }
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "create-branch": {
        const fields: FormField[] = [
          { key: "name", label: "Nombre de la rama", placeholder: "feature/mi-rama", required: true },
          {
            key: "start",
            label: "Punto de partida",
            initial: dialog.startPoint,
            placeholder: "HEAD o un hash/rama/tag",
            hint: "Déjalo vacío para partir de HEAD.",
          },
        ];
        const checks: FormCheck[] = [
          {
            key: "checkout",
            label: "Hacer checkout de la nueva rama",
            hint: "Cambia el árbol de trabajo a la rama recién creada.",
          },
        ];
        return (
          <TextFormDialog
            title="Nueva rama"
            subtitle={dialog.startPoint ? `Desde ${dialog.startPoint.slice(0, 7)}` : "Desde HEAD"}
            fields={fields}
            checks={checks}
            submitLabel="Crear rama"
            onSubmit={(values, checked) =>
              void createBranch(
                values.name.trim(),
                values.start.trim() || null,
                checked.checkout ?? false,
              )
            }
            onClose={() => setDialog(null)}
          />
        );
      }
      case "rename-branch":
        return (
          <TextFormDialog
            title="Renombrar rama"
            subtitle={dialog.branch.name}
            fields={[
              {
                key: "name",
                label: "Nuevo nombre",
                initial: dialog.branch.name,
                required: true,
              },
            ]}
            submitLabel="Renombrar"
            onSubmit={(values) => {
              const next = values.name.trim();
              if (next === dialog.branch.name) {
                setDialog(null);
                return;
              }
              void renameBranch(dialog.branch, next);
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "delete-branch":
        return (
          <TextFormDialog
            title="Borrar rama"
            subtitle={dialog.branch.name}
            note={
              <Warning>
                Borrar una rama puede dejar commits sin ninguna referencia. Esta acción no se puede deshacer desde la app.
              </Warning>
            }
            fields={[
              {
                key: "confirm",
                label: `Escribe «${dialog.branch.name}» para confirmar`,
                placeholder: dialog.branch.name,
                required: true,
              },
            ]}
            checks={[
              {
                key: "force",
                label: "Forzar borrado (-D)",
                hint: "Permite borrar ramas con commits que aún no están fusionados.",
              },
            ]}
            submitLabel="Borrar rama"
            danger
            onSubmit={(values, checked) => {
              if (values.confirm.trim() !== dialog.branch.name) {
                fail({ message: "El nombre escrito no coincide con el de la rama." });
                return;
              }
              void deleteBranch(dialog.branch, checked.force ?? false);
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "delete-tag":
        return (
          <ConfirmDialog
            title="Borrar etiqueta"
            message={
              <span>
                Se borrará la etiqueta <strong>{dialog.tag.name}</strong>.
              </span>
            }
            consequences={[
              "La etiqueta solo se elimina en este repositorio local.",
              "Los commits a los que apunta permanecerán intactos.",
            ]}
            confirmLabel="Borrar etiqueta"
            danger
            onConfirm={() => void deleteTag(dialog.tag)}
            onClose={() => setDialog(null)}
          />
        );
      case "tag":
        return (
          <TextFormDialog
            title="Crear etiqueta"
            subtitle={`Apuntando a ${dialog.revLabel}`}
            fields={[
              { key: "name", label: "Nombre de la etiqueta", placeholder: "v1.0.0", required: true },
              {
                key: "target",
                label: "Commit o referencia",
                initial: dialog.rev,
                required: true,
              },
              {
                key: "message",
                label: "Mensaje (opcional)",
                hint: "Si escribes un mensaje se crea una etiqueta anotada.",
                textarea: true,
              },
            ]}
            submitLabel="Crear etiqueta"
            onSubmit={(values) =>
              void createTag(values.name.trim(), values.target.trim(), values.message.trim() || null)
            }
            onClose={() => setDialog(null)}
          />
        );
      case "merge":
        return (
          <MergeDialog
            branches={branches}
            currentBranch={currentBranch}
            mergeInProgress={Boolean(info?.mergeInProgress)}
            onMerge={(target, noFf, squash, message) => void handleMerge(target, noFf, squash, message)}
            onAbort={() => {
              setDialog(null);
              void abortOperation("merge");
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "rebase":
        return (
          <RebaseDialog
            branches={branches}
            currentBranch={currentBranch}
            rebaseInProgress={Boolean(info?.rebaseInProgress)}
            onRebase={(target) => void handleRebase(target)}
            onAbort={() => {
              setDialog(null);
              void abortOperation("rebase");
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "reset":
        return (
          <ResetDialog
            rev={dialog.rev}
            shortHash={dialog.shortHash}
            onReset={(mode) => void handleReset(dialog.rev, mode)}
            onClose={() => setDialog(null)}
          />
        );
      case "conflicts":
        return (
          <ConflictsDialog
            status={status}
            onShow={(file) => {
              setDialog(null);
              showWip();
              void openWipFile(file, false);
            }}
            onResolveSide={(file, side) => void resolveSide(file, side)}
            onMarkResolved={(file) => void markResolved(file)}
            onClose={() => setDialog(null)}
          />
        );
      case "stash":
        return (
          <TextFormDialog
            title="Guardar cambios en stash"
            fields={[
              {
                key: "message",
                label: "Mensaje (opcional)",
                placeholder: "Trabajo en curso",
              },
            ]}
            checks={[
              {
                key: "untracked",
                label: "Incluir archivos no rastreados",
                hint: "También guarda archivos nuevos que Git aún no rastrea.",
                initial: dialog.includeUntracked,
              },
            ]}
            submitLabel="Guardar stash"
            onSubmit={(values, checked) =>
              void createStash(values.message.trim() || null, checked.untracked ?? false)
            }
            onClose={() => setDialog(null)}
          />
        );
      case "drop-stash":
        return (
          <ConfirmDialog
            title="Borrar stash"
            message={
              <span>
                Se eliminará <strong>{dialog.stash.selector}</strong> ({dialog.stash.subject}).
              </span>
            }
            consequences={[
              "Los cambios guardados en ese stash se perderán si no están aplicados en otra parte.",
              "Git no ofrece una papelera para stashes eliminados.",
            ]}
            confirmLabel="Borrar stash"
            danger
            acknowledge="Entiendo que perderé los cambios guardados en este stash."
            onConfirm={() => void dropStash(dialog.stash)}
            onClose={() => setDialog(null)}
          />
        );
      case "add-remote":
        return (
          <TextFormDialog
            title="Agregar remoto"
            fields={[
              {
                key: "name",
                label: "Nombre del remoto",
                initial: remotes.length === 0 ? "origin" : "",
                placeholder: "origin",
                required: true,
              },
              {
                key: "url",
                label: "URL",
                placeholder: "https://… o git@…",
                required: true,
              },
            ]}
            submitLabel="Agregar remoto"
            onSubmit={(values) => void addRemote(values.name.trim(), values.url.trim())}
            onClose={() => setDialog(null)}
          />
        );
      case "remove-remote":
        return (
          <ConfirmDialog
            title="Quitar remoto"
            message={
              <span>
                Se quitará el remoto <strong>{dialog.remote.name}</strong> ({dialog.remote.fetchUrl}).
              </span>
            }
            consequences={[
              "Se eliminan las referencias remotas locales de ese remoto.",
              "El repositorio remoto en sí no se modifica.",
            ]}
            confirmLabel="Quitar remoto"
            danger
            onConfirm={() => void removeRemote(dialog.remote)}
            onClose={() => setDialog(null)}
          />
        );
      case "discard-file":
        return (
          <ConfirmDialog
            title="Descartar cambios"
            message={
              <span>
                Se descartarán los cambios de <code>{dialog.file.path}</code>.
              </span>
            }
            consequences={[
              "Se perderán los cambios no confirmados de este archivo.",
              dialog.file.untracked
                ? "Como es un archivo no rastreado, se borrará del disco."
                : "El archivo volverá al contenido del último commit.",
            ]}
            confirmLabel="Descartar"
            danger
            acknowledge="Entiendo que esta acción no se puede deshacer."
            onConfirm={() => discardFile(dialog.file)}
            onClose={() => setDialog(null)}
          />
        );
      case "discard-all":
        return (
          <ConfirmDialog
            title="Descartar todos los cambios"
            message="Se descartarán todos los cambios sin preparar del árbol de trabajo."
            consequences={[
              "Se perderán todos los cambios no confirmados.",
              "Los archivos no rastreados se eliminarán del disco.",
              "El área de preparación no se modifica.",
            ]}
            confirmLabel="Descartar todo"
            danger
            acknowledge="Entiendo que perderé cambios de forma irreversible."
            onConfirm={() => void discardAll()}
            onClose={() => setDialog(null)}
          />
        );
      case "force-push":
        return (
          <ConfirmDialog
            title="Force push con lease"
            message={
              <span>
                Se reescribirá la rama remota de <strong>{currentBranch ?? "HEAD"}</strong> usando{" "}
                <code>--force-with-lease</code>.
              </span>
            }
            consequences={[
              "Puede sobrescribir commits que otras personas hayan publicado en el remoto.",
              "--force-with-lease falla si el remoto cambió desde tu último fetch, pero no elimina ese riesgo por completo.",
              "La app no guarda credenciales: Git usará tu configuración.",
            ]}
            confirmLabel="Hacer force push"
            danger
            acknowledge="Entiendo que puedo sobrescribir trabajo remoto."
            onConfirm={() => void handlePush({ force: true }, true)}
            onClose={() => setDialog(null)}
          />
        );
      case "undo":
        return (
          <ConfirmDialog
            title="Deshacer última operación"
            message={undoStatus?.undoLabel ?? "Se moverá HEAD al estado anterior."}
            consequences={[
              "Se ejecuta git reset --hard sobre el estado capturado antes de la operación.",
              "El árbol de trabajo debe estar limpio; de lo contrario Git rechazará la operación.",
              undoStatus?.warning ?? "Revisa el resultado en el grafo antes de continuar.",
            ]}
            confirmLabel="Deshacer"
            danger
            acknowledge="Entiendo que se moverá HEAD y se descartará el estado actual del árbol."
            onConfirm={() => void handleUndo()}
            onClose={() => setDialog(null)}
          />
        );
      case "redo":
        return (
          <ConfirmDialog
            title="Rehacer operación"
            message={undoStatus?.redoLabel ?? "Se moverá HEAD al estado posterior."}
            consequences={[
              "Se ejecuta git reset --hard sobre el estado que se había deshecho.",
              "El árbol de trabajo debe estar limpio.",
            ]}
            confirmLabel="Rehacer"
            danger
            acknowledge="Entiendo que se moverá HEAD."
            onConfirm={() => void handleRedo()}
            onClose={() => setDialog(null)}
          />
        );
      default:
        return null;
    }
  }

  const missingGit = boot !== null && !boot.git.available;

  return (
    <div className="app">
      <TopBar
        repos={repos}
        activePath={activePath}
        onSelectRepo={(path) => void switchRepo(path)}
        onCloseRepo={closeRepo}
        onAddRepo={() => setDialog({ type: "repo", tab: "open" })}
        onUndo={() => setDialog({ type: "undo" })}
        onRedo={() => setDialog({ type: "redo" })}
        undoStatus={undoStatus}
        onFetch={() => void handleFetch()}
        onPull={(mode) => void handlePull(mode)}
        onPush={(options) => {
          if (options.force) setDialog({ type: "force-push" });
          else void handlePush(options);
        }}
        onBranchAction={handleBranchAction}
        onStashAction={handleStashAction}
        onPop={() => handleStashAction("pop-latest")}
        onToggleTerminal={() => setTerminalOpen((value) => !value)}
        terminalOpen={terminalOpen}
        theme={theme}
        onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        hasRepo={hasRepo}
        hasSelection={hasSelection}
        operationInProgress={operationInProgress}
      />

      <main className="app-main">
        {bootLoading ? (
          <BootScreen />
        ) : missingGit ? (
          <GitMissingScreen loading={bootLoading} onRetry={() => void loadBootstrap()} />
        ) : bootError ? (
          <div className="center-screen">
            <Warning>
              <strong>{bootError.title}</strong>
              <p>{bootError.message}</p>
            </Warning>
            <button className="primary-button" onClick={() => void loadBootstrap()}>
              Reintentar
            </button>
          </div>
        ) : !hasRepo ? (
          <WelcomeScreen
            recents={recents}
            loading={repoLoading}
            onOpenDialog={(tab) => setDialog({ type: "repo", tab })}
            onOpen={(path) => void openRepo(path)}
            onRemoveRecent={async (path) => {
              try {
                setRecents(await api.removeRecent(path));
              } catch (value) {
                fail(value, "No se pudo quitar el reciente");
              }
            }}
          />
        ) : (
          <>
            {repoLoading && (
              <div className="repo-loading">
                <Loader2 size={18} className="spin" /> Abriendo repositorio…
              </div>
            )}
            <Sidebar
              repoPath={activePath ?? ""}
              branches={branches}
              tags={tags}
              stashes={stashes}
              worktrees={worktrees}
              remotes={remotes}
              loading={repoLoading}
              highlightName={highlightName}
              onHighlightBranch={(branch) =>
                setHighlightName(
                  branch.isRemote ? `${branch.remote ?? ""}/${branch.name}` : branch.name,
                )
              }
              onCheckout={(branch) => void checkoutBranch(branch)}
              onRenameBranch={(branch) => setDialog({ type: "rename-branch", branch })}
              onDeleteBranch={(branch) => setDialog({ type: "delete-branch", branch })}
              onDeleteTag={(tag) => setDialog({ type: "delete-tag", tag })}
              onApplyStash={(stash, pop) => void applyStash(stash, pop)}
              onDropStash={(stash) => setDialog({ type: "drop-stash", stash })}
              onOpenWorktree={(worktree) => void openRepo(worktree.path)}
              onAddRemote={() => setDialog({ type: "add-remote" })}
              onRemoveRemote={(remote) => setDialog({ type: "remove-remote", remote })}
              onFetchRemote={(remote) => void handleFetch(remote.name)}
              onOpenRepos={() => setDialog({ type: "repo", tab: "open" })}
            />

            <GraphView
              commits={commits}
              hasMore={hasMore}
              loading={historyLoading}
              selectedHash={selectedHash}
              onSelectCommit={selectCommit}
              onSelectWip={showWip}
              wipSelected={wipSelected}
              wipCount={wipCount}
              wipStaged={status?.staged.length ?? 0}
              wipUnstaged={status?.unstaged.length ?? 0}
              wipConflicts={status?.conflicted.length ?? 0}
              highlightName={highlightName}
              onClearHighlight={() => setHighlightName(null)}
              onLoadMore={() => void loadMore()}
              onRefresh={() => void refreshView()}
              scrollTarget={scrollTarget}
              searchQuery={searchQuery}
              searchKind={searchKind}
              activeFilterQuery={activeFilter?.query ?? null}
              onSearchQueryChange={setSearchQuery}
              onSearchKindChange={setSearchKind}
              onSearch={submitSearch}
              onClearSearch={clearSearch}
              onContextMenu={openCommitContext}
            />

            {info && status && (
              <RightPanel
                repo={info}
                status={status}
                wipSelected={wipSelected}
                details={details}
                detailsLoading={detailsLoading}
                selectedFile={selectedFile}
                diff={diff}
                diffLoading={diffLoading}
                diffMode={diffMode}
                conflict={conflict}
                conflictLoading={conflictLoading}
                summary={summary}
                description={description}
                amend={amend}
                sign={sign}
                committing={committing}
                onSelectCommitFile={(file) => {
                  const path = activePathRef.current;
                  if (path && selectedHashRef.current) {
                    void loadCommitFile(
                      path,
                      selectedHashRef.current,
                      file.path,
                      file.oldPath ?? null,
                      file.status,
                    );
                  }
                }}
                onSelectWipFile={(file, staged) => void openWipFile(file, staged)}
                onApplyPatch={applyPatch}
                onStage={(paths) => void stagePaths(paths)}
                onUnstage={(paths) => void unstagePaths(paths)}
                onStageAll={() => void stageAll()}
                onUnstageAll={() => void unstageAll()}
                onDiscard={(file) => setDialog({ type: "discard-file", file })}
                onDiscardAll={() => setDialog({ type: "discard-all" })}
                onCommit={() => void commitChanges()}
                onAbortOperation={(value) => void abortOperation(value)}
                onShowConflict={(file) => void openWipFile(file, false)}
                onResolveSide={(file, side) => void resolveSide(file, side)}
                onMarkResolved={(file) => void markResolved(file)}
                onBlame={(path) => void openBlame(path)}
                onHistory={(path) => void openFileHistory(path)}
                onSummaryChange={setSummary}
                onDescriptionChange={setDescription}
                onAmendChange={setAmend}
                onSignChange={setSign}
                onCopy={(text) => void copyText(text)}
                onBackToChanges={() => undefined}
              />
            )}
          </>
        )}
      </main>

      <TerminalPanel
        open={terminalOpen && hasRepo}
        repoPath={activePath}
        onClose={() => setTerminalOpen(false)}
      />

      <StatusBar info={info} status={status} loading={repoLoading} />

      {renderDialog()}

      {operation && (
        <OperationOverlay operation={operation} onCancel={() => void cancelOperation()} />
      )}

      {error && (
        <ErrorDialog
          title={error.title}
          message={error.message}
          detail={error.detail}
          onClose={() => setError(null)}
        />
      )}

      {blameDialog && (
        <BlameDialog
          path={blameDialog.path}
          lines={blameDialog.lines}
          loading={blameDialog.loading}
          onClose={() => setBlameDialog(null)}
        />
      )}

      {fileHistory && (
        <FileHistoryDialog
          path={fileHistory.path}
          commits={fileHistory.commits}
          loading={fileHistory.loading}
          onClose={() => setFileHistory(null)}
          onSelect={(hash) => {
            setFileHistory(null);
            void jumpToCommit(hash);
          }}
        />
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            className="context-item"
            onClick={() => {
              setContextMenu(null);
              selectCommit(contextMenu.commit);
            }}
          >
            Ver detalles
          </button>
          <button
            className="context-item"
            onClick={() => {
              const commit = contextMenu.commit;
              setContextMenu(null);
              setDialog({ type: "create-branch", startPoint: commit.hash });
            }}
          >
            Crear rama aquí…
          </button>
          <button
            className="context-item"
            onClick={() => {
              const commit = contextMenu.commit;
              setContextMenu(null);
              setDialog({
                type: "tag",
                rev: commit.hash,
                revLabel: commit.shortHash,
              });
            }}
          >
            Crear etiqueta aquí…
          </button>
          <div className="context-separator" />
          <button
            className="context-item"
            onClick={() => {
              const commit = contextMenu.commit;
              setContextMenu(null);
              const path = activePathRef.current;
              if (path) void handleOutcome("Cherry-pick", () => api.cherryPick(path, commit.hash));
            }}
          >
            Cherry-pick
          </button>
          <button
            className="context-item"
            onClick={() => {
              const commit = contextMenu.commit;
              setContextMenu(null);
              const path = activePathRef.current;
              if (path) void handleOutcome("Revert", () => api.revertCommit(path, commit.hash));
            }}
          >
            Revertir commit
          </button>
          <button
            className="context-item is-danger"
            onClick={() => {
              const commit = contextMenu.commit;
              setContextMenu(null);
              setDialog({ type: "reset", rev: commit.hash, shortHash: commit.shortHash });
            }}
          >
            Reset a este commit…
          </button>
          <div className="context-separator" />
          <button
            className="context-item"
            onClick={() => {
              const hash = contextMenu.commit.hash;
              setContextMenu(null);
              void copyText(hash);
            }}
          >
            Copiar hash
          </button>
        </div>
      )}

      <ToastHost toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function BootScreen() {
  return (
    <div className="center-screen">
      <img src="/logo.png" alt="" className="boot-logo" />
      <div className="boot-line">
        <Loader2 size={16} className="spin" /> Iniciando Git Leviathan…
      </div>
    </div>
  );
}

function GitMissingScreen({ loading, onRetry }: { loading: boolean; onRetry: () => void }) {
  return (
    <div className="install-screen">
      <img src="/logo.png" alt="" className="install-logo" />
      <h1>Git no está disponible</h1>
      <p className="install-lead">
        Git Leviathan no incluye Git, no lo instala y no modifica tu sistema. Instala Git con tu
        gestor habitual y vuelve a intentarlo.
      </p>
      <div className="install-grid">
        <div className="install-card">
          <h3>Windows</h3>
          <code>winget install --id Git.Git -e</code>
          <p>O descárgalo desde git-scm.com y deja que el instalador añada Git al PATH.</p>
        </div>
        <div className="install-card">
          <h3>macOS</h3>
          <code>brew install git</code>
          <p>También puedes usar <code>xcode-select --install</code>.</p>
        </div>
        <div className="install-card">
          <h3>Linux</h3>
          <code>sudo apt install git</code>
          <p>Usa el gestor de paquetes de tu distribución si no es Debian/Ubuntu.</p>
        </div>
      </div>
      <p className="muted">
        Después de instalar Git, cierra y vuelve a abrir la aplicación o pulsa el botón.
      </p>
      <button className="primary-button" onClick={onRetry} disabled={loading}>
        {loading ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
        Reintentar detección
      </button>
    </div>
  );
}

function WelcomeScreen({
  recents,
  loading,
  onOpenDialog,
  onOpen,
  onRemoveRecent,
}: {
  recents: string[];
  loading: boolean;
  onOpenDialog: (tab: "open" | "init" | "clone") => void;
  onOpen: (path: string) => void;
  onRemoveRecent: (path: string) => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <img src="/logo.png" alt="Git Leviathan" className="welcome-logo" />
        <div>
          <h1>Git Leviathan</h1>
          <p>
            Cliente Git de escritorio, completamente local. Usa el Git de tu sistema, respeta tu
            configuración, tus hooks y tus credenciales. Sin cuenta, sin nube y sin telemetría.
          </p>
        </div>
      </div>

      <div className="welcome-actions">
        <button className="primary-button" onClick={() => onOpenDialog("open")} disabled={loading}>
          <FolderOpen size={15} /> Abrir repositorio
        </button>
        <button className="action-button" onClick={() => onOpenDialog("clone")} disabled={loading}>
          <CloudDownload size={15} /> Clonar
        </button>
        <button className="action-button" onClick={() => onOpenDialog("init")} disabled={loading}>
          <Plus size={15} /> Inicializar
        </button>
      </div>

      <section className="welcome-recents">
        <h2>Recientes</h2>
        {recents.length === 0 ? (
          <p className="muted">
            Todavía no hay repositorios recientes. Solo se guarda esta lista en los datos locales de
            la aplicación.
          </p>
        ) : (
          recents.map((path) => (
            <div className="recent-card" key={path}>
              <button className="recent-card-main" onClick={() => onOpen(path)} title={path}>
                <GitBranch size={15} />
                <span className="recent-card-name">{path.split(/[\\/]/).filter(Boolean).pop()}</span>
                <span className="recent-card-path">{path}</span>
              </button>
              <button
                className="micro-button"
                onClick={() => onRemoveRecent(path)}
                title="Quitar de recientes"
              >
                Quitar
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function StatusBar({
  info,
  status,
  loading,
}: {
  info: RepoInfo | null;
  status: StatusInfo | null;
  loading: boolean;
}) {
  if (!info) {
    return (
      <footer className="statusbar">
        <span className="statusbar-brand">Git Leviathan</span>
        <span className="statusbar-spacer" />
        <span className="status-local">100% local · sin telemetría</span>
      </footer>
    );
  }
  const missingIdentity = !info.identityName || !info.identityEmail;
  return (
    <footer className={`statusbar ${missingIdentity ? "has-warning" : ""}`}>
      {loading && <Loader2 size={12} className="spin sync-indicator" />}
      <div className="status-identity">
        <User size={13} />
        {missingIdentity ? (
          <span className="identity-warning">
            Identidad de Git incompleta: configura user.name y user.email en tu terminal.
          </span>
        ) : (
          <>
            <strong>{info.identityName}</strong>
            <span className="muted">&lt;{info.identityEmail}&gt;</span>
          </>
        )}
        {(info.identityNameOrigin || info.identityEmailOrigin) && (
          <span
            className="status-origin"
            title={`user.name: ${info.identityNameOrigin ?? "—"}\nuser.email: ${info.identityEmailOrigin ?? "—"}`}
          >
            {shortOrigin(info.identityNameOrigin || info.identityEmailOrigin)}
          </span>
        )}
      </div>
      <span className="statusbar-spacer" />
      <span className="status-branch">
        <GitBranch size={12} />
        {info.branch ?? "HEAD desacoplado"}
      </span>
      {status?.upstream && (
        <span className="status-upstream" title={`Upstream: ${status.upstream}`}>
          ↑ {status.ahead} · ↓ {status.behind}
        </span>
      )}
      <span className="status-version">git {info.gitVersion}</span>
      <span className="status-local">100% local</span>
    </footer>
  );
}

function ConflictsDialog({
  status,
  onShow,
  onResolveSide,
  onMarkResolved,
  onClose,
}: {
  status: StatusInfo | null;
  onShow: (file: FileStatus) => void;
  onResolveSide: (file: FileStatus, side: "ours" | "theirs") => void;
  onMarkResolved: (file: FileStatus) => void;
  onClose: () => void;
}) {
  const files = status?.conflicted ?? [];
  return (
    <Modal
      title="Resolver conflictos"
      subtitle="Elige un lado o marca el archivo como resuelto después de editarlo."
      onClose={onClose}
      wide
    >
      {files.length === 0 ? (
        <div className="panel-loading">No hay archivos en conflicto.</div>
      ) : (
        <div className="conflict-dialog-list">
          {files.map((file) => (
            <div className="conflict-dialog-row" key={file.path}>
              <button className="conflict-dialog-main" onClick={() => onShow(file)} title={file.path}>
                <AlertTriangle size={14} />
                <span className="file-path">{file.path}</span>
              </button>
              <div className="conflict-dialog-actions">
                <button className="micro-button" onClick={() => onResolveSide(file, "ours")}>
                  Nuestro
                </button>
                <button className="micro-button" onClick={() => onResolveSide(file, "theirs")}>
                  Suyo
                </button>
                <button className="micro-button" onClick={() => onMarkResolved(file)}>
                  Resuelto
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

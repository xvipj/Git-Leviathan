import { invoke } from "@tauri-apps/api/core";
import type {
  ActionOutcome,
  AppBootstrap,
  BlameLine,
  Branch,
  CommitDetails,
  CommitEntry,
  ConflictSides,
  DiffResult,
  GitOpResult,
  HistoryFilter,
  HistoryPage,
  Remote,
  RepoState,
  Stash,
  Tag,
  UndoStatus,
  Worktree,
} from "./types";

export const api = {
  bootstrap: () => invoke<AppBootstrap>("bootstrap"),
  openRepository: (path: string) =>
    invoke<RepoState>("open_repository", { path }),
  refreshRepo: (path: string) => invoke<RepoState>("refresh_repo", { path }),
  initRepository: (path: string) =>
    invoke<RepoState>("init_repository", { path }),
  cloneRepository: (url: string, destination: string, operationId: string) =>
    invoke<RepoState>("clone_repository", {
      url,
      destination,
      operationId,
    }),
  listRecents: () => invoke<string[]>("list_recents"),
  removeRecent: (path: string) =>
    invoke<string[]>("remove_recent", { path }),

  getHistory: (
    repoPath: string,
    skip: number,
    limit: number,
    filter?: HistoryFilter | null,
  ) =>
    invoke<HistoryPage>("get_history", {
      repoPath,
      skip,
      limit,
      filter: filter ?? null,
    }),
  getCommitDetails: (repoPath: string, hash: string) =>
    invoke<CommitDetails>("get_commit_details", { repoPath, hash }),
  getFileDiff: (
    repoPath: string,
    filePath: string,
    mode: "unstaged" | "staged" | "commit",
    commit?: string | null,
    oldPath?: string | null,
    untracked = false,
    context = 3,
  ) =>
    invoke<DiffResult>("get_file_diff", {
      repoPath,
      filePath,
      mode,
      commit: commit ?? null,
      oldPath: oldPath ?? null,
      untracked,
      context,
    }),
  getBlame: (repoPath: string, filePath: string) =>
    invoke<BlameLine[]>("get_blame", { repoPath, filePath }),
  getFileHistory: (repoPath: string, filePath: string, limit = 100) =>
    invoke<CommitEntry[]>("get_file_history", {
      repoPath,
      filePath,
      limit,
    }),

  stagePaths: (repoPath: string, paths: string[]) =>
    invoke<GitOpResult>("stage_paths", { repoPath, paths }),
  stageAll: (repoPath: string) =>
    invoke<GitOpResult>("stage_all", { repoPath }),
  unstagePaths: (repoPath: string, paths: string[]) =>
    invoke<GitOpResult>("unstage_paths", { repoPath, paths }),
  unstageAll: (repoPath: string) =>
    invoke<GitOpResult>("unstage_all", { repoPath }),
  discardPaths: (repoPath: string, paths: string[], confirmed: boolean) =>
    invoke<GitOpResult>("discard_paths", { repoPath, paths, confirmed }),
  discardAll: (repoPath: string, confirmed: boolean) =>
    invoke<GitOpResult>("discard_all", { repoPath, confirmed }),
  applyPatch: (
    repoPath: string,
    patch: string,
    cached: boolean,
    reverse: boolean,
  ) =>
    invoke<GitOpResult>("apply_patch", {
      repoPath,
      patch,
      cached,
      reverse,
    }),
  commitChanges: (
    repoPath: string,
    message: string,
    amend: boolean,
    sign: boolean,
  ) =>
    invoke<GitOpResult>("commit_changes", {
      repoPath,
      message,
      amend,
      sign,
    }),

  listBranches: (repoPath: string) =>
    invoke<Branch[]>("list_branches", { repoPath }),
  listTags: (repoPath: string) => invoke<Tag[]>("list_tags", { repoPath }),
  listStashes: (repoPath: string) =>
    invoke<Stash[]>("list_stashes", { repoPath }),
  listWorktrees: (repoPath: string) =>
    invoke<Worktree[]>("list_worktrees", { repoPath }),
  listRemotes: (repoPath: string) =>
    invoke<Remote[]>("list_remotes", { repoPath }),
  checkoutBranch: (repoPath: string, branch: string, isRemote: boolean) =>
    invoke<GitOpResult>("checkout_branch", {
      repoPath,
      branch,
      isRemote,
    }),
  createBranch: (
    repoPath: string,
    name: string,
    startPoint?: string | null,
    checkout = false,
  ) =>
    invoke<GitOpResult>("create_branch", {
      repoPath,
      name,
      startPoint: startPoint ?? null,
      checkout,
    }),
  renameBranch: (repoPath: string, oldName: string, newName: string) =>
    invoke<GitOpResult>("rename_branch", { repoPath, oldName, newName }),
  deleteBranch: (
    repoPath: string,
    name: string,
    force: boolean,
    confirmed: boolean,
  ) =>
    invoke<GitOpResult>("delete_branch", {
      repoPath,
      name,
      force,
      confirmed,
    }),
  createTag: (
    repoPath: string,
    name: string,
    rev: string,
    message?: string | null,
  ) =>
    invoke<GitOpResult>("create_tag", {
      repoPath,
      name,
      rev,
      message: message ?? null,
    }),
  deleteTag: (repoPath: string, name: string) =>
    invoke<GitOpResult>("delete_tag", { repoPath, name }),
  createStash: (
    repoPath: string,
    message?: string | null,
    includeUntracked = false,
  ) =>
    invoke<GitOpResult>("create_stash", {
      repoPath,
      message: message ?? null,
      includeUntracked,
    }),
  applyStash: (repoPath: string, selector: string, pop: boolean) =>
    invoke<GitOpResult>("apply_stash", { repoPath, selector, pop }),
  dropStash: (repoPath: string, selector: string, confirmed: boolean) =>
    invoke<GitOpResult>("drop_stash", {
      repoPath,
      selector,
      confirmed,
    }),
  addRemote: (repoPath: string, name: string, url: string) =>
    invoke<GitOpResult>("add_remote", { repoPath, name, url }),
  removeRemote: (repoPath: string, name: string) =>
    invoke<GitOpResult>("remove_remote", { repoPath, name }),

  mergeBranch: (
    repoPath: string,
    rev: string,
    noFf: boolean,
    squash: boolean,
    message?: string | null,
  ) =>
    invoke<ActionOutcome>("merge_branch", {
      repoPath,
      rev,
      noFf,
      squash,
      message: message ?? null,
    }),
  abortMerge: (repoPath: string) =>
    invoke<GitOpResult>("abort_merge", { repoPath }),
  rebaseOnto: (repoPath: string, rev: string) =>
    invoke<ActionOutcome>("rebase_onto", { repoPath, rev }),
  abortRebase: (repoPath: string) =>
    invoke<GitOpResult>("abort_rebase", { repoPath }),
  cherryPick: (repoPath: string, rev: string) =>
    invoke<ActionOutcome>("cherry_pick_commit", { repoPath, rev }),
  abortCherryPick: (repoPath: string) =>
    invoke<GitOpResult>("abort_cherry_pick", { repoPath }),
  revertCommit: (repoPath: string, rev: string) =>
    invoke<ActionOutcome>("revert_commit", { repoPath, rev }),
  abortRevert: (repoPath: string) =>
    invoke<GitOpResult>("abort_revert", { repoPath }),
  resetToCommit: (
    repoPath: string,
    rev: string,
    mode: "soft" | "mixed" | "hard",
    confirmed: boolean,
  ) =>
    invoke<GitOpResult>("reset_to_commit", {
      repoPath,
      rev,
      mode,
      confirmed,
    }),
  getConflictSides: (repoPath: string, filePath: string) =>
    invoke<ConflictSides>("get_conflict_sides", { repoPath, filePath }),
  markResolved: (repoPath: string, filePath: string) =>
    invoke<GitOpResult>("mark_resolved", { repoPath, filePath }),
  resolveWithSide: (
    repoPath: string,
    filePath: string,
    side: "ours" | "theirs",
  ) =>
    invoke<GitOpResult>("resolve_with_side", {
      repoPath,
      filePath,
      side,
    }),
  getUndoStatus: (repoPath: string) =>
    invoke<UndoStatus>("get_undo_status", { repoPath }),
  undoLast: (repoPath: string) =>
    invoke<string>("undo_last", { repoPath }),
  redoLast: (repoPath: string) =>
    invoke<string>("redo_last", { repoPath }),

  fetchRemote: (
    repoPath: string,
    remote: string | null,
    prune: boolean,
    operationId: string,
  ) =>
    invoke<GitOpResult>("fetch_remote", {
      repoPath,
      remote,
      prune,
      operationId,
    }),
  pullRemote: (
    repoPath: string,
    remote: string | null,
    mode: "default" | "merge" | "rebase" | "ff-only",
    operationId: string,
  ) =>
    invoke<GitOpResult>("pull_remote", {
      repoPath,
      remote,
      mode,
      operationId,
    }),
  pushRemote: (
    repoPath: string,
    remote: string | null,
    setUpstream: boolean,
    forceWithLease: boolean,
    confirmed: boolean,
    operationId: string,
  ) =>
    invoke<GitOpResult>("push_remote", {
      repoPath,
      remote,
      setUpstream,
      forceWithLease,
      confirmed,
      operationId,
    }),
  cancelOperation: (operationId: string) =>
    invoke<boolean>("cancel_operation", { operationId }),

  spawnTerminal: (
    repoPath: string,
    id: string,
    rows: number,
    cols: number,
  ) =>
    invoke<string>("spawn_terminal", { repoPath, id, rows, cols }),
  terminalWrite: (id: string, data: string) =>
    invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: string, rows: number, cols: number) =>
    invoke<void>("terminal_resize", { id, rows, cols }),
  terminalClose: (id: string) => invoke<void>("terminal_close", { id }),
};

export function errorText(error: unknown): { message: string; detail: string } {
  if (typeof error === "string") {
    return { message: error, detail: "" };
  }
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; stderr?: unknown; code?: unknown };
    const message =
      typeof value.message === "string"
        ? value.message
        : "Se produjo un error inesperado.";
    const detail = typeof value.stderr === "string" ? value.stderr : "";
    return { message, detail };
  }
  return { message: String(error), detail: "" };
}

export function newOperationId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

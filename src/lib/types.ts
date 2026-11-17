export interface GitInfo {
  available: boolean;
  version: string;
  executable: string;
}

export interface AppBootstrap {
  git: GitInfo;
  recents: string[];
}

export interface RepoInfo {
  path: string;
  name: string;
  gitVersion: string;
  gitDir: string;
  head: string | null;
  shortHead: string | null;
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  identityName: string | null;
  identityEmail: string | null;
  identityNameOrigin: string | null;
  identityEmailOrigin: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  cherryPickInProgress: boolean;
  revertInProgress: boolean;
  signConfigured: boolean;
  hasCommits: boolean;
}

export interface FileStatus {
  path: string;
  origPath?: string | null;
  status: string;
  untracked: boolean;
  conflicted: boolean;
}

export interface StatusInfo {
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileStatus[];
  unstaged: FileStatus[];
  conflicted: FileStatus[];
}

export interface RepoState {
  info: RepoInfo;
  status: StatusInfo;
}

export interface Branch {
  name: string;
  fullName: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream: string | null;
  head: string;
  subject: string;
  date: string;
  remote: string | null;
}

export interface Tag {
  name: string;
  fullName: string;
  target: string;
  objectType: string;
  annotated: boolean;
  tagger: string | null;
  date: string;
  subject: string;
}

export interface Stash {
  index: number;
  selector: string;
  hash: string;
  subject: string;
  date: string;
}

export interface Worktree {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface RefDecoration {
  name: string;
  kind: "branch" | "remote" | "tag" | "head" | "other";
}

export interface CommitEntry {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  time: number;
  authorDate: string;
  subject: string;
  refs: RefDecoration[];
}

export interface HistoryPage {
  commits: CommitEntry[];
  hasMore: boolean;
}

export type HistoryKind = "message" | "author" | "file" | "hash";

export interface HistoryFilter {
  query: string;
  kind: HistoryKind;
}

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: string;
}

export interface CommitDetails {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  subject: string;
  body: string;
  refs: RefDecoration[];
  files: ChangedFile[];
}

export interface DiffResult {
  content: string;
  binary: boolean;
  untracked: boolean;
}

export interface ConflictSides {
  ours: string;
  theirs: string;
  oursLabel: string;
  theirsLabel: string;
  binary: boolean;
}

export interface BlameLine {
  line: number;
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  time: number;
  summary: string;
  content: string;
  uncommitted: boolean;
}

export interface UndoStatus {
  canUndo: boolean;
  canRedo: boolean;
  warning: string | null;
  undoLabel: string | null;
  redoLabel: string | null;
}

export interface GitOpResult {
  stdout: string;
  stderr: string;
}

export interface ActionOutcome {
  success: boolean;
  conflicts: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface AppErrorShape {
  message?: string;
  stderr?: string | null;
  code?: number | null;
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudDownload,
  FolderGit2,
  GitBranch,
  PanelLeftClose,
  Pencil,
  Play,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import type { Branch, Remote, Stash, Tag, Worktree } from "../lib/types";
import type { SidebarSectionId } from "../lib/layout";
import { relativeTime } from "../lib/format";
import type { SectionRequest } from "../hooks/useLayout";
import { IconButton } from "./ui";

interface SidebarProps {
  repoPath: string;
  branches: Branch[];
  tags: Tag[];
  stashes: Stash[];
  worktrees: Worktree[];
  remotes: Remote[];
  loading: boolean;
  highlightName: string | null;
  collapsedSections: Record<SidebarSectionId, boolean>;
  focusSection: SectionRequest | null;
  overlay?: boolean;
  onToggleSection: (id: SidebarSectionId) => void;
  onCollapse: () => void;
  onHighlightBranch: (branch: Branch) => void;
  onCheckout: (branch: Branch) => void;
  onRenameBranch: (branch: Branch) => void;
  onDeleteBranch: (branch: Branch) => void;
  onDeleteTag: (tag: Tag) => void;
  onApplyStash: (stash: Stash, pop: boolean) => void;
  onDropStash: (stash: Stash) => void;
  onOpenWorktree: (worktree: Worktree) => void;
  onAddRemote: () => void;
  onRemoveRemote: (remote: Remote) => void;
  onFetchRemote: (remote: Remote) => void;
  onOpenRepos: () => void;
}

export function Sidebar({
  repoPath,
  branches,
  tags,
  stashes,
  worktrees,
  remotes,
  loading,
  highlightName,
  collapsedSections,
  focusSection,
  overlay = false,
  onToggleSection,
  onCollapse,
  onHighlightBranch,
  onCheckout,
  onRenameBranch,
  onDeleteBranch,
  onDeleteTag,
  onApplyStash,
  onDropStash,
  onOpenWorktree,
  onAddRemote,
  onRemoveRemote,
  onFetchRemote,
  onOpenRepos,
}: SidebarProps) {
  const [filter, setFilter] = useState("");
  const normalized = filter.trim().toLowerCase();

  useEffect(() => {
    if (!focusSection) return;
    const element = document.getElementById(`sidebar-section-${focusSection.id}`);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [focusSection]);

  const localBranches = useMemo(
    () =>
      branches
        .filter((branch) => !branch.isRemote)
        .filter((branch) => !normalized || branch.name.toLowerCase().includes(normalized)),
    [branches, normalized],
  );
  const remoteBranches = useMemo(
    () =>
      branches
        .filter((branch) => branch.isRemote)
        .filter(
          (branch) =>
            !normalized ||
            `${branch.remote}/${branch.name}`.toLowerCase().includes(normalized),
        ),
    [branches, normalized],
  );
  const filteredTags = useMemo(
    () => tags.filter((tag) => !normalized || tag.name.toLowerCase().includes(normalized)),
    [tags, normalized],
  );
  const filteredStashes = useMemo(
    () =>
      stashes.filter(
        (stash) =>
          !normalized ||
          stash.subject.toLowerCase().includes(normalized) ||
          stash.selector.toLowerCase().includes(normalized),
      ),
    [stashes, normalized],
  );
  const filteredWorktrees = useMemo(
    () =>
      worktrees.filter(
        (worktree) =>
          !normalized ||
          worktree.path.toLowerCase().includes(normalized) ||
          (worktree.branch ?? "").toLowerCase().includes(normalized),
      ),
    [worktrees, normalized],
  );
  const filteredRemotes = useMemo(
    () => remotes.filter((remote) => !normalized || remote.name.toLowerCase().includes(normalized)),
    [remotes, normalized],
  );

  return (
    <aside
      className={`sidebar ${overlay ? "is-overlay" : ""}`}
      id="sidebar-panel"
      aria-label="Explorador de ramas"
    >
      <div className="sidebar-top">
        <div className="sidebar-title">
          <span>Explorador</span>
          <span className="sidebar-title-actions">
            <button className="link-button" onClick={onOpenRepos}>
              Repos
            </button>
            <IconButton
              label="Ocultar panel izquierdo"
              expanded
              onClick={onCollapse}
            >
              <PanelLeftClose size={15} />
            </IconButton>
          </span>
        </div>
        <div className="search-field">
          <Search size={14} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filtrar ramas, tags, stashes…"
            spellCheck={false}
          />
          {filter && (
            <button className="search-clear" onClick={() => setFilter("")} aria-label="Limpiar filtro">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className={`sidebar-scroll ${loading ? "is-loading" : ""}`}>
        <Section
          id="local"
          title="Ramas locales"
          count={localBranches.length}
          icon={<GitBranch size={13} />}
          open={!collapsedSections.local}
          onToggle={() => onToggleSection("local")}
        >
          {localBranches.length === 0 && <SmallEmpty>Sin ramas</SmallEmpty>}
          {localBranches.map((branch) => {
            const display = branch.name;
            return (
              <div
                key={branch.fullName}
                className={`side-item ${branch.isCurrent ? "is-current" : ""} ${
                  highlightName === display ? "is-highlighted" : ""
                }`}
                onClick={() => onHighlightBranch(branch)}
                onDoubleClick={() => onCheckout(branch)}
                title={`${branch.name}\n${branch.subject}\nDoble clic para hacer checkout`}
              >
                <span className={`branch-dot ${branch.isCurrent ? "is-current" : ""}`} />
                <span className="side-item-main">
                  <span className="side-item-name">{branch.name}</span>
                  <span className="side-item-sub">
                    {branch.isCurrent ? "actual" : branch.upstream ? `→ ${branch.upstream}` : branch.subject}
                  </span>
                </span>
                <span className="side-actions">
                  {!branch.isCurrent && (
                    <>
                      <IconButton
                        label="Renombrar rama"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRenameBranch(branch);
                        }}
                        className="mini"
                      >
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton
                        label="Borrar rama"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteBranch(branch);
                        }}
                        className="mini"
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </Section>

        <Section
          id="remote"
          title="Ramas remotas"
          count={remoteBranches.length}
          icon={<Cloud size={13} />}
          open={!collapsedSections.remote}
          onToggle={() => onToggleSection("remote")}
        >
          {remoteBranches.length === 0 && <SmallEmpty>Sin ramas remotas</SmallEmpty>}
          {remoteBranches.map((branch) => {
            const display = `${branch.remote}/${branch.name}`;
            return (
              <div
                key={branch.fullName}
                className={`side-item ${highlightName === display ? "is-highlighted" : ""}`}
                onClick={() => onHighlightBranch(branch)}
                onDoubleClick={() => onCheckout(branch)}
                title={`${display}\n${branch.subject}\nDoble clic para hacer checkout`}
              >
                <span className="branch-dot is-remote" />
                <span className="side-item-main">
                  <span className="side-item-name">{display}</span>
                  <span className="side-item-sub">{branch.subject}</span>
                </span>
                <span className="side-actions">
                  <IconButton
                    label="Checkout de rama remota"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCheckout(branch);
                    }}
                    className="mini"
                  >
                    <Play size={12} />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </Section>

        <Section
          id="tags"
          title="Etiquetas"
          count={filteredTags.length}
          icon={<TagIcon size={13} />}
          open={!collapsedSections.tags}
          onToggle={() => onToggleSection("tags")}
        >
          {filteredTags.length === 0 && <SmallEmpty>Sin etiquetas</SmallEmpty>}
          {filteredTags.map((tag) => (
            <div key={tag.fullName} className="side-item" title={`${tag.name}\n${tag.subject || "Sin mensaje"}`}>
              <TagIcon size={13} className="side-icon" />
              <span className="side-item-main">
                <span className="side-item-name">{tag.name}</span>
                <span className="side-item-sub">
                  {tag.annotated ? "anotada" : "ligera"} · {relativeTime(tag.date)}
                </span>
              </span>
              <span className="side-actions">
                <IconButton
                  label="Borrar etiqueta"
                  onClick={() => onDeleteTag(tag)}
                  className="mini"
                >
                  <Trash2 size={12} />
                </IconButton>
              </span>
            </div>
          ))}
        </Section>

        <Section
          id="stashes"
          title="Stashes"
          count={filteredStashes.length}
          icon={<Archive size={13} />}
          open={!collapsedSections.stashes}
          onToggle={() => onToggleSection("stashes")}
        >
          {filteredStashes.length === 0 && <SmallEmpty>Sin stashes</SmallEmpty>}
          {filteredStashes.map((stash) => (
            <div key={stash.selector} className="side-item" title={`${stash.selector}\n${stash.subject}`}>
              <Archive size={13} className="side-icon" />
              <span className="side-item-main">
                <span className="side-item-name">{stash.subject || stash.selector}</span>
                <span className="side-item-sub">
                  {stash.selector} · {relativeTime(stash.date)}
                </span>
              </span>
              <span className="side-actions">
                <IconButton
                  label="Aplicar stash"
                  onClick={() => onApplyStash(stash, false)}
                  className="mini"
                >
                  <Play size={12} />
                </IconButton>
                <IconButton
                  label="Pop stash"
                  onClick={() => onApplyStash(stash, true)}
                  className="mini"
                >
                  <ArchiveRestore size={12} />
                </IconButton>
                <IconButton label="Borrar stash" onClick={() => onDropStash(stash)} className="mini">
                  <Trash2 size={12} />
                </IconButton>
              </span>
            </div>
          ))}
        </Section>

        <Section
          id="worktrees"
          title="Worktrees"
          count={filteredWorktrees.length}
          icon={<FolderGit2 size={13} />}
          open={!collapsedSections.worktrees}
          onToggle={() => onToggleSection("worktrees")}
        >
          {filteredWorktrees.length === 0 && <SmallEmpty>Sin worktrees</SmallEmpty>}
          {filteredWorktrees.map((worktree) => (
            <div
              key={worktree.path}
              className="side-item"
              onDoubleClick={() => onOpenWorktree(worktree)}
              title={worktree.path}
            >
              <FolderGit2 size={13} className="side-icon" />
              <span className="side-item-main">
                <span className="side-item-name">{worktree.branch ?? "(detached)"}</span>
                <span className="side-item-sub">
                  {worktree.path === repoPath ? "repositorio actual" : shortenPath(worktree.path)}
                </span>
              </span>
              {worktree.path !== repoPath && (
                <span className="side-actions">
                  <IconButton
                    label="Abrir worktree"
                    onClick={() => onOpenWorktree(worktree)}
                    className="mini"
                  >
                    <Play size={12} />
                  </IconButton>
                </span>
              )}
            </div>
          ))}
        </Section>

        <Section
          id="remotes"
          title="Remotos"
          count={filteredRemotes.length}
          icon={<CloudDownload size={13} />}
          open={!collapsedSections.remotes}
          onToggle={() => onToggleSection("remotes")}
          action={
            <IconButton label="Agregar remoto" onClick={onAddRemote} className="mini">
              <Plus size={12} />
            </IconButton>
          }
        >
          {filteredRemotes.length === 0 && <SmallEmpty>Sin remotos</SmallEmpty>}
          {filteredRemotes.map((remote) => (
            <div key={remote.name} className="side-item" title={`${remote.name}\n${remote.fetchUrl}`}>
              <CloudDownload size={13} className="side-icon" />
              <span className="side-item-main">
                <span className="side-item-name">{remote.name}</span>
                <span className="side-item-sub">{remote.fetchUrl}</span>
              </span>
              <span className="side-actions">
                <IconButton
                  label="Fetch de este remoto"
                  onClick={() => onFetchRemote(remote)}
                  className="mini"
                >
                  <CloudDownload size={12} />
                </IconButton>
                <IconButton
                  label="Quitar remoto"
                  onClick={() => onRemoveRemote(remote)}
                  className="mini"
                >
                  <Trash2 size={12} />
                </IconButton>
              </span>
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}

function Section({
  id,
  title,
  count,
  icon,
  children,
  action,
  open,
  onToggle,
}: {
  id: SidebarSectionId;
  title: string;
  count: number;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="side-section" id={`sidebar-section-${id}`}>
      <div className="side-section-header">
        <button
          className="side-section-toggle"
          onClick={onToggle}
          aria-expanded={open}
          title={open ? `Contraer ${title}` : `Expandir ${title}`}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {icon}
          <span>{title}</span>
          <span className="side-count">{count}</span>
        </button>
        {action}
      </div>
      {open && <div className="side-section-body">{children}</div>}
    </div>
  );
}

function SmallEmpty({ children }: { children: ReactNode }) {
  return <div className="side-empty">{children}</div>;
}

function shortenPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.length <= 42) return normalized;
  return `…${normalized.slice(-40)}`;
}

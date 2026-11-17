import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderTree, List } from "lucide-react";
import type { ChangedFile, FileStatus } from "../lib/types";
import { fileName } from "../lib/format";

export interface FileEntry {
  path: string;
  oldPath?: string | null;
  status: string;
  untracked?: boolean;
  conflicted?: boolean;
}

interface FileListProps {
  files: Array<ChangedFile | FileStatus>;
  selectedPath: string | null;
  onSelect: (file: FileEntry) => void;
  emptyText?: string;
}

interface TreeNode {
  name: string;
  path: string;
  file?: FileEntry;
  children: TreeNode[];
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      let child = current.children.find((node) => node.name === part && Boolean(node.file) === isFile);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
          file: isFile ? (file as FileEntry) : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (Boolean(a.file) !== Boolean(b.file)) return a.file ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

export function FileList({ files, selectedPath, onSelect, emptyText }: FileListProps) {
  const [view, setView] = useState<"flat" | "tree">("tree");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const entries = files as FileEntry[];
  const tree = useMemo(() => buildTree(entries), [entries]);

  if (files.length === 0) {
    return <div className="file-list-empty">{emptyText ?? "Sin archivos"}</div>;
  }

  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    if (node.file) {
      return (
        <button
          key={node.path}
          className={`file-row ${selectedPath === node.file.path ? "is-selected" : ""}`}
          onClick={() => onSelect(node.file!)}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={node.file.path}
        >
          <File size={13} className="file-icon" />
          <span className="file-path">{node.name}</span>
          <StatusLetter status={node.file.status} />
        </button>
      );
    }
    const isCollapsed = collapsed.has(node.path);
    return (
      <div key={node.path}>
        <button
          className="file-row is-folder"
          onClick={() => toggle(node.path)}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <Folder size={13} className="file-icon" />
          <span className="file-path">{node.name}</span>
        </button>
        {!isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="file-list">
      <div className="file-list-head">
        <span>{entries.length} archivo{entries.length === 1 ? "" : "s"}</span>
        <div className="segmented tiny">
          <button className={view === "flat" ? "is-active" : ""} onClick={() => setView("flat")} title="Vista de ruta">
            <List size={12} /> Ruta
          </button>
          <button className={view === "tree" ? "is-active" : ""} onClick={() => setView("tree")} title="Vista de árbol">
            <FolderTree size={12} /> Árbol
          </button>
        </div>
      </div>
      <div className="file-list-body">
        {view === "tree"
          ? tree.map((node) => renderNode(node, 0))
          : entries.map((file) => (
              <button
                key={file.path}
                className={`file-row ${selectedPath === file.path ? "is-selected" : ""}`}
                onClick={() => onSelect(file)}
                title={file.path}
              >
                <File size={13} className="file-icon" />
                <span className="file-path">{file.path}</span>
                <StatusLetter status={file.status} />
              </button>
            ))}
      </div>
    </div>
  );
}

export function StatusLetter({ status }: { status: string }) {
  const letter = status === "?" ? "?" : status.charAt(0).toUpperCase();
  return <span className={`status-letter status-${letter.toLowerCase()}`}>{letter}</span>;
}

export function basename(path: string): string {
  return fileName(path);
}

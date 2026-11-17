import { useState } from "react";
import { Search, X } from "lucide-react";
import type { BlameLine, CommitEntry } from "../lib/types";
import { avatarColor, fileName, fullDate, initials, relativeTime } from "../lib/format";
import { Modal, Spinner, EmptyState } from "./ui";

export function BlameDialog({
  path,
  lines,
  loading,
  onClose,
}: {
  path: string;
  lines: BlameLine[];
  loading: boolean;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const normalized = filter.trim().toLowerCase();
  const visible = normalized
    ? lines.filter(
        (line) =>
          line.content.toLowerCase().includes(normalized) ||
          line.author.toLowerCase().includes(normalized) ||
          line.hash.toLowerCase().includes(normalized),
      )
    : lines;

  return (
    <Modal
      title={`Blame · ${fileName(path)}`}
      subtitle={path}
      onClose={onClose}
      wide
      footer={<span className="muted">{lines.length.toLocaleString("es")} líneas</span>}
    >
      <div className="modal-search">
        <Search size={14} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar blame…" spellCheck={false} />
        {filter && (
          <button className="search-clear" onClick={() => setFilter("")}>
            <X size={12} />
          </button>
        )}
      </div>
      {loading ? (
        <div className="panel-loading"><Spinner /> Ejecutando git blame…</div>
      ) : lines.length === 0 ? (
        <EmptyState title="Sin datos de blame">Git no devolvió información para este archivo.</EmptyState>
      ) : (
        <div className="blame-list">
          {visible.slice(0, 5000).map((line) => (
            <div className="blame-line" key={`${line.line}-${line.hash}`}>
              <span className="blame-num">{line.line}</span>
              <span
                className="blame-author"
                style={{ color: avatarColor(line.author) }}
                title={`${line.author} <${line.email}> · ${fullDate(line.time)}\n${line.summary}`}
              >
                {line.uncommitted ? "sin commit" : line.shortHash}
              </span>
              <span className="blame-content">{line.content || " "}</span>
            </div>
          ))}
          {visible.length > 5000 && (
            <div className="diff-truncated">Se muestran las primeras 5000 líneas.</div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function FileHistoryDialog({
  path,
  commits,
  loading,
  onClose,
  onSelect,
}: {
  path: string;
  commits: CommitEntry[];
  loading: boolean;
  onClose: () => void;
  onSelect: (hash: string) => void;
}) {
  return (
    <Modal title={`Historial · ${fileName(path)}`} subtitle={path} onClose={onClose}>
      {loading ? (
        <div className="panel-loading"><Spinner /> Cargando historial del archivo…</div>
      ) : commits.length === 0 ? (
        <EmptyState title="Sin historial">Este archivo no tiene commits en el historial actual.</EmptyState>
      ) : (
        <div className="file-history-list">
          {commits.map((commit) => (
            <button className="file-history-row" key={commit.hash} onClick={() => onSelect(commit.hash)}>
              <span className="avatar" style={{ background: avatarColor(commit.authorName) }}>
                {initials(commit.authorName)}
              </span>
              <span className="file-history-main">
                <strong>{commit.subject}</strong>
                <small>{commit.authorName} · {relativeTime(commit.time)}</small>
              </span>
              <span className="mono muted">{commit.shortHash}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

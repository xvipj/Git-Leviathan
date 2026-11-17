import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/common";
import {
  AlertTriangle,
  Check,
  Columns2,
  FileCode2,
  History,
  Loader2,
  Rows3,
} from "lucide-react";
import type { DiffResult } from "../lib/types";
import { buildPatch, parseDiff, splitHunk, type DiffFile, type DiffHunk, type DiffLine } from "../lib/diff";
import { fileName } from "../lib/format";
import { Spinner } from "./ui";

interface DiffViewProps {
  diff: DiffResult | null;
  filePath: string | null;
  oldPath?: string | null;
  loading: boolean;
  mode: "unstaged" | "staged" | "commit";
  onApplyPatch?: (patch: string, cached: boolean, reverse: boolean) => Promise<void>;
  onShowBlame?: () => void;
  onShowHistory?: () => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  html: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  md: "markdown",
  sql: "sql",
  dockerfile: "dockerfile",
  vue: "xml",
  svelte: "xml",
};

function languageFor(path: string | null, content: string): string {
  if (!path) return "plaintext";
  const name = fileName(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  const extension = name.includes(".") ? name.split(".").pop()! : "";
  if (LANGUAGE_MAP[extension]) return LANGUAGE_MAP[extension];
  if (content.startsWith("#!/")) return "bash";
  return "plaintext";
}

function highlightLine(code: string, language: string): string {
  if (!code) return "";
  try {
    if (language === "plaintext" || !hljs.getLanguage(language)) {
      return escapeHtml(code);
    }
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function DiffView({
  diff,
  filePath,
  oldPath,
  loading,
  mode,
  onApplyPatch,
  onShowBlame,
  onShowHistory,
}: DiffViewProps) {
  const [view, setView] = useState<"unified" | "split">("unified");
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const [busyHunk, setBusyHunk] = useState<string | null>(null);

  const files = useMemo(() => (diff ? parseDiff(diff.content) : []), [diff]);
  const language = useMemo(
    () => languageFor(filePath, diff?.content ?? ""),
    [filePath, diff?.content],
  );

  useEffect(() => {
    setSelected({});
    setBusyHunk(null);
  }, [diff?.content]);

  const toggleLine = (fileIndex: number, hunkIndex: number, line: DiffLine) => {
    if (line.type !== "+" && line.type !== "-") return;
    const key = `${fileIndex}:${hunkIndex}`;
    setSelected((current) => {
      const next = { ...current };
      const set = new Set(next[key] ?? []);
      if (set.has(line.index)) set.delete(line.index);
      else set.add(line.index);
      next[key] = set;
      return next;
    });
  };

  const apply = async (
    fileIndex: number,
    hunkIndex: number,
    file: DiffFile,
    hunk: DiffHunk,
    selection: Set<number> | null,
  ) => {
    if (!onApplyPatch) return;
    const patch = buildPatch(file, hunk, selection);
    if (!patch) return;
    const key = `${fileIndex}:${hunkIndex}`;
    setBusyHunk(key);
    try {
      await onApplyPatch(patch, true, mode === "staged");
      setSelected((current) => ({ ...current, [key]: new Set() }));
    } finally {
      setBusyHunk(null);
    }
  };

  if (loading) {
    return (
      <div className="diff-loading">
        <Spinner size={18} /> Cargando diferencias…
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="diff-empty">
        <FileCode2 size={30} />
        <strong>Selecciona un archivo</strong>
        <p>Podrás ver su diff unificado o lado a lado.</p>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="diff-empty">
        <FileCode2 size={24} />
        <strong>Sin diferencias</strong>
        <p>El archivo no cambió en esta vista.</p>
      </div>
    );
  }

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <div className="diff-file-title" title={filePath}>
          <FileCode2 size={15} />
          <span>{fileName(filePath)}</span>
          {oldPath && oldPath !== filePath && <small>← {oldPath}</small>}
        </div>
        <div className="diff-toolbar-spacer" />
        {mode === "commit" && onShowHistory && (
          <button className="small-button" onClick={onShowHistory} title="Historial del archivo">
            <History size={13} /> Historial
          </button>
        )}
        {mode === "commit" && onShowBlame && (
          <button className="small-button" onClick={onShowBlame} title="git blame del archivo">
            Blame
          </button>
        )}
        <div className="segmented">
          <button className={view === "unified" ? "is-active" : ""} onClick={() => setView("unified")} title="Vista unificada">
            <Rows3 size={13} /> Unificado
          </button>
          <button className={view === "split" ? "is-active" : ""} onClick={() => setView("split")} title="Vista lado a lado">
            <Columns2 size={13} /> Lado a lado
          </button>
        </div>
      </div>

      {diff.binary && (
        <div className="binary-notice">
          <AlertTriangle size={18} />
          <div>
            <strong>Archivo binario</strong>
            <p>Git detectó contenido binario y no se muestra el diff textual.</p>
          </div>
        </div>
      )}

      {!diff.binary && diff.untracked && (
        <div className="untracked-notice">
          Archivo nuevo sin rastrear. Prepara el archivo completo desde el panel de cambios.
        </div>
      )}

      {!diff.binary && files.length === 0 && (
        <div className="diff-empty">
          <strong>Sin diferencias de texto</strong>
          <p>El archivo podría ser binario, estar vacío o no tener cambios.</p>
        </div>
      )}

      {files.map((file, fileIndex) => {
        if (file.combined) {
          return (
            <div className="combined-diff" key={`${fileIndex}-combined`}>
              <div className="binary-notice">
                <AlertTriangle size={16} />
                <div>
                  <strong>Diff combinado de conflicto</strong>
                  <p>Este archivo tiene varias versiones. Usa la vista de conflicto para elegir los lados.</p>
                </div>
              </div>
              <pre>{file.raw}</pre>
            </div>
          );
        }
        return file.hunks.map((hunk, hunkIndex) => {
          const key = `${fileIndex}:${hunkIndex}`;
          const selection = selected[key] ?? new Set<number>();
          const staged = mode === "staged";
          return (
            <div className="hunk" key={key}>
              <div className="hunk-header">
                <code>{hunk.header}</code>
                <div className="hunk-actions">
                  {selection.size > 0 && onApplyPatch && !diff.untracked && (
                    <button
                      className="small-button"
                      disabled={busyHunk === key}
                      onClick={() => apply(fileIndex, hunkIndex, file, hunk, selection)}
                      title={staged ? "Quitar del área de preparación las líneas seleccionadas" : "Preparar las líneas seleccionadas"}
                    >
                      {busyHunk === key ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                      {staged ? "Quitar" : "Preparar"} {selection.size} línea{selection.size === 1 ? "" : "s"}
                    </button>
                  )}
                  {onApplyPatch && !diff.untracked && (
                    <button
                      className="small-button"
                      disabled={busyHunk === key}
                      onClick={() => apply(fileIndex, hunkIndex, file, hunk, null)}
                      title={staged ? "Quitar el bloque del área de preparación" : "Preparar el bloque completo"}
                    >
                      {staged ? "Quitar bloque" : "Preparar bloque"}
                    </button>
                  )}
                </div>
              </div>
              {view === "unified" ? (
                <div className="diff-table">
                  {hunk.lines.slice(0, 5000).map((line) => {
                    const isSelected = selection.has(line.index);
                    return (
                      <div
                        key={line.index}
                        className={`diff-line diff-${line.type === " " ? "context" : line.type === "+" ? "add" : line.type === "-" ? "del" : "meta"} ${
                          isSelected ? "is-selected" : ""
                        } ${line.type === "+" || line.type === "-" ? "is-selectable" : ""}`}
                        onClick={() => toggleLine(fileIndex, hunkIndex, line)}
                      >
                        <span className="diff-num">{line.oldLine ?? ""}</span>
                        <span className="diff-num">{line.newLine ?? ""}</span>
                        <span className="diff-marker">{line.type === " " ? "" : line.type}</span>
                        <span
                          className="diff-code"
                          dangerouslySetInnerHTML={{
                            __html:
                              line.type === "\\"
                                ? escapeHtml(line.text)
                                : highlightLine(line.text, language),
                          }}
                        />
                      </div>
                    );
                  })}
                  {hunk.lines.length > 5000 && (
                    <div className="diff-truncated">
                      Se muestran las primeras 5000 líneas de este bloque.
                    </div>
                  )}
                </div>
              ) : (
                <div className="split-diff">
                  {splitHunk(hunk).slice(0, 5000).map((row, rowIndex) => (
                    <div className="split-row" key={rowIndex}>
                      <SplitCell line={row.left} language={language} side="left" />
                      <SplitCell line={row.right} language={language} side="right" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        });
      })}
    </div>
  );
}

function SplitCell({
  line,
  language,
  side,
}: {
  line: DiffLine | null;
  language: string;
  side: "left" | "right";
}) {
  if (!line) {
    return <div className="split-cell is-empty" />;
  }
  return (
    <div
      className={`split-cell split-${line.type === " " ? "context" : line.type === "+" ? "add" : line.type === "-" ? "del" : "meta"}`}
    >
      <span className="diff-num">{side === "left" ? line.oldLine ?? "" : line.newLine ?? ""}</span>
      <span
        className="split-code"
        dangerouslySetInnerHTML={{
          __html:
            line.type === "\\"
              ? escapeHtml(line.text)
              : highlightLine(line.text, language),
        }}
      />
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Copy,
  GitCommit,
  GitMerge,
  Loader2,
  RotateCcw,
  User,
} from "lucide-react";
import type {
  CommitDetails,
  ConflictSides,
  DiffResult,
  FileStatus,
  RepoInfo,
  StatusInfo,
} from "../lib/types";
import { avatarColor, fullDate, initials, plural, relativeTime } from "../lib/format";
import { Badge, Spinner, Warning } from "./ui";
import { DiffView } from "./DiffView";
import { FileList, type FileEntry } from "./FileList";

export type DiffMode = "unstaged" | "staged" | "commit";

interface RightPanelProps {
  repo: RepoInfo;
  status: StatusInfo;
  wipSelected: boolean;
  details: CommitDetails | null;
  detailsLoading: boolean;
  selectedFile: FileEntry | null;
  diff: DiffResult | null;
  diffLoading: boolean;
  diffMode: DiffMode;
  conflict: ConflictSides | null;
  conflictLoading: boolean;
  summary: string;
  description: string;
  amend: boolean;
  sign: boolean;
  committing: boolean;
  onSelectCommitFile: (file: FileEntry) => void;
  onSelectWipFile: (file: FileStatus, staged: boolean) => void;
  onApplyPatch: (patch: string, cached: boolean, reverse: boolean) => Promise<void>;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscard: (file: FileStatus) => void;
  onDiscardAll: () => void;
  onCommit: () => void;
  onAbortOperation: (operation: "merge" | "rebase" | "cherry-pick" | "revert") => void;
  onShowConflict: (file: FileStatus) => void;
  onResolveSide: (file: FileStatus, side: "ours" | "theirs") => void;
  onMarkResolved: (file: FileStatus) => void;
  onBlame: (path: string) => void;
  onHistory: (path: string) => void;
  onSummaryChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onAmendChange: (value: boolean) => void;
  onSignChange: (value: boolean) => void;
  onCopy: (text: string) => void;
  onBackToChanges: () => void;
}

export function RightPanel(props: RightPanelProps) {
  const [tab, setTab] = useState<"files" | "diff">("files");

  useEffect(() => {
    setTab("files");
  }, [props.wipSelected, props.details?.hash]);

  const showDiff = () => setTab("diff");
  const selectCommitFile = (file: FileEntry) => {
    props.onSelectCommitFile(file);
    showDiff();
  };
  const selectWipFile = (file: FileStatus, staged: boolean) => {
    props.onSelectWipFile(file, staged);
    showDiff();
  };
  const showConflict = (file: FileStatus) => {
    props.onShowConflict(file);
    showDiff();
  };

  if (props.wipSelected) {
    return (
      <aside className="right-panel">
        <WipHeader {...props} />
        <div className="right-tabs">
          <button className={tab === "files" ? "is-active" : ""} onClick={() => setTab("files")}>
            Cambios
            <span className="tab-count">
              {props.status.staged.length + props.status.unstaged.length + props.status.conflicted.length}
            </span>
          </button>
          <button className={tab === "diff" ? "is-active" : ""} onClick={() => setTab("diff")}>
            Diff
          </button>
        </div>
        {tab === "files" ? (
          <>
            <div className="right-scroll">
              <WipChanges {...props} onSelect={selectWipFile} onShowConflict={showConflict} />
            </div>
            <CommitBox {...props} />
          </>
        ) : (
          <div className="right-scroll diff-scroll">
            <WipDiff
              {...props}
              onSelect={selectWipFile}
              onBackToChanges={() => setTab("files")}
            />
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="right-panel">
      <CommitHeader details={props.details} loading={props.detailsLoading} onCopy={props.onCopy} />
      <div className="right-tabs">
        <button className={tab === "files" ? "is-active" : ""} onClick={() => setTab("files")}>
          Archivos
          <span className="tab-count">{props.details?.files.length ?? 0}</span>
        </button>
        <button className={tab === "diff" ? "is-active" : ""} onClick={() => setTab("diff")}>
          Diff
        </button>
      </div>
      <div className={`right-scroll ${tab === "diff" ? "diff-scroll" : ""}`}>
        {tab === "files" ? (
          props.details ? (
            <FileList
              files={props.details.files}
              selectedPath={props.selectedFile?.path ?? null}
              onSelect={selectCommitFile}
              emptyText="Este commit no muestra archivos (posible merge sin cambios respecto al primer padre)."
            />
          ) : (
            <div className="panel-loading">
              {props.detailsLoading ? <><Spinner /> Cargando commit…</> : "Selecciona un commit"}
            </div>
          )
        ) : (
          <DiffView
            diff={props.diff}
            filePath={props.selectedFile?.path ?? null}
            oldPath={props.selectedFile?.oldPath}
            loading={props.diffLoading}
            mode="commit"
            onShowBlame={
              props.selectedFile
                ? () => props.onBlame(props.selectedFile!.path)
                : undefined
            }
            onShowHistory={
              props.selectedFile
                ? () => props.onHistory(props.selectedFile!.path)
                : undefined
            }
          />
        )}
      </div>
    </aside>
  );
}

function CommitHeader({
  details,
  loading,
  onCopy,
}: {
  details: CommitDetails | null;
  loading: boolean;
  onCopy: (text: string) => void;
}) {
  if (!details) {
    return (
      <div className="commit-header is-empty">
        {loading ? (
          <div className="panel-loading"><Spinner /> Cargando commit…</div>
        ) : (
          <div className="panel-loading">Selecciona un commit para ver sus detalles</div>
        )}
      </div>
    );
  }
  return (
    <div className="commit-header">
      <div className="commit-header-top">
        <span className="avatar large" style={{ background: avatarColor(details.authorName) }}>
          {initials(details.authorName)}
        </span>
        <div className="commit-title-block">
          <h2 title={details.subject}>{details.subject}</h2>
          <div className="commit-refs-line">
            {details.refs.map((ref) => (
              <Badge
                key={`${ref.kind}-${ref.name}`}
                kind={ref.kind === "branch" ? "branch" : ref.kind === "remote" ? "remote" : ref.kind === "tag" ? "tag" : "head"}
              >
                {ref.name}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      {details.body && <pre className="commit-body">{details.body}</pre>}
      <div className="commit-meta-grid">
        <span className="meta-label">Hash</span>
        <span className="meta-value mono">
          {details.hash}
          <button className="copy-button" onClick={() => onCopy(details.hash)} title="Copiar hash">
            <Copy size={11} />
          </button>
        </span>
        <span className="meta-label"><User size={12} /> Autor</span>
        <span className="meta-value">
          {details.authorName} <span className="muted">&lt;{details.authorEmail}&gt;</span>
        </span>
        <span className="meta-label">Fecha</span>
        <span className="meta-value" title={fullDate(details.authorDate)}>
          {relativeTime(details.authorDate)} · {fullDate(details.authorDate)}
        </span>
        <span className="meta-label">Committer</span>
        <span className="meta-value">
          {details.committerName} <span className="muted">&lt;{details.committerEmail}&gt;</span>
        </span>
        {details.parents.length > 0 && (
          <>
            <span className="meta-label">Padres</span>
            <span className="meta-value mono">
              {details.parents.map((parent) => parent.slice(0, 7)).join(", ")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function WipHeader(props: RightPanelProps) {
  const { repo, status } = props;
  const operation = repo.mergeInProgress
    ? "merge"
    : repo.rebaseInProgress
      ? "rebase"
      : repo.cherryPickInProgress
        ? "cherry-pick"
        : repo.revertInProgress
          ? "revert"
          : null;
  return (
    <div className="wip-header">
      <div className="wip-header-title">
        <div>
          <h2>Cambios sin confirmar</h2>
          <p>
            {status.branch ?? "HEAD desacoplado"} · {plural(status.staged.length, "preparado", "preparados")} ·{" "}
            {plural(status.unstaged.length, "sin preparar", "sin preparar")}
          </p>
        </div>
        <GitCommit size={20} />
      </div>
      {operation && (
        <div className="operation-banner">
          <GitMerge size={15} />
          <span>
            {operation === "merge"
              ? "Merge en curso"
              : operation === "rebase"
                ? "Rebase en curso"
                : operation === "cherry-pick"
                  ? "Cherry-pick en curso"
                  : "Revert en curso"}
          </span>
          <button
            className="small-button"
            onClick={() => props.onAbortOperation(operation)}
          >
            <RotateCcw size={12} /> Abortar
          </button>
        </div>
      )}
    </div>
  );
}

function WipChanges({
  status,
  onSelect,
  onShowConflict,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onDiscard,
  onDiscardAll,
  onResolveSide,
  onMarkResolved,
}: RightPanelProps & {
  onSelect: (file: FileStatus, staged: boolean) => void;
  onShowConflict: (file: FileStatus) => void;
}) {
  return (
    <div className="wip-changes">
      {status.conflicted.length > 0 && (
        <section className="wip-section conflicts">
          <header>
            <span><AlertTriangle size={13} /> Conflictos</span>
            <span className="section-count">{status.conflicted.length}</span>
          </header>
          {status.conflicted.map((file) => (
            <div className="wip-file conflict-file" key={file.path}>
              <button className="wip-file-main" onClick={() => onShowConflict(file)} title="Ver ambos lados">
                <span className="file-path">{file.path}</span>
                <span className="status-letter status-u">U</span>
              </button>
              <div className="wip-file-actions">
                <button className="micro-button" onClick={() => onResolveSide(file, "ours")} title="Usar nuestro lado y marcar resuelto">
                  Nuestro
                </button>
                <button className="micro-button" onClick={() => onResolveSide(file, "theirs")} title="Usar su lado y marcar resuelto">
                  Suyo
                </button>
                <button className="micro-button" onClick={() => onMarkResolved(file)} title="Marcar como resuelto con el contenido actual">
                  Resuelto
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="wip-section">
        <header>
          <span>Preparados</span>
          <span className="section-count">{status.staged.length}</span>
          <div className="section-actions">
            <button className="micro-button" disabled={status.staged.length === 0} onClick={onUnstageAll}>
              Quitar todo
            </button>
          </div>
        </header>
        {status.staged.length === 0 ? (
          <div className="section-empty">Nada preparado todavía.</div>
        ) : (
          status.staged.map((file) => (
            <div className="wip-file" key={`staged-${file.path}`}>
              <button className="wip-file-main" onClick={() => onSelect(file, true)}>
                <span className="file-path">{file.path}</span>
                <span className={`status-letter status-${file.status.toLowerCase()}`}>{file.status}</span>
              </button>
              <div className="wip-file-actions">
                <button className="micro-button" onClick={() => onUnstage([file.path])}>
                  Quitar
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="wip-section">
        <header>
          <span>Sin preparar</span>
          <span className="section-count">{status.unstaged.length}</span>
          <div className="section-actions">
            <button className="micro-button" disabled={status.unstaged.length === 0} onClick={onStageAll}>
              Preparar todo
            </button>
            <button className="micro-button danger" disabled={status.unstaged.length === 0} onClick={onDiscardAll}>
              Descartar todo
            </button>
          </div>
        </header>
        {status.unstaged.length === 0 ? (
          <div className="section-empty">No hay cambios sin preparar.</div>
        ) : (
          status.unstaged.map((file) => (
            <div className="wip-file" key={`unstaged-${file.path}`}>
              <button className="wip-file-main" onClick={() => onSelect(file, false)}>
                <span className="file-path">{file.path}</span>
                <span className={`status-letter status-${file.untracked ? "?" : file.status.toLowerCase()}`}>
                  {file.untracked ? "?" : file.status}
                </span>
              </button>
              <div className="wip-file-actions">
                <button className="micro-button" onClick={() => onStage([file.origPath, file.path].filter(Boolean) as string[])}>
                  Preparar
                </button>
                <button className="micro-button danger" onClick={() => onDiscard(file)}>
                  Descartar
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function WipDiff({
  diff,
  diffLoading,
  selectedFile,
  diffMode,
  conflict,
  conflictLoading,
  onApplyPatch,
  onBlame,
  onHistory,
  onResolveSide,
  onMarkResolved,
  onBackToChanges,
}: RightPanelProps & { onSelect: (file: FileStatus, staged: boolean) => void }) {
  if (conflictLoading) {
    return <div className="diff-loading"><Spinner /> Cargando conflicto…</div>;
  }
  const conflictFile: FileStatus | null = selectedFile
    ? {
        path: selectedFile.path,
        origPath: selectedFile.oldPath ?? null,
        status: selectedFile.status,
        untracked: Boolean(selectedFile.untracked),
        conflicted: Boolean(selectedFile.conflicted),
      }
    : null;
  if (conflict) {
    return (
      <div className="conflict-view">
        <div className="conflict-toolbar">
          <button className="small-button" onClick={onBackToChanges}>
            <ChevronLeft size={13} /> Cambios
          </button>
          <span className="muted">Comparación de ambos lados del conflicto</span>
        </div>
        {conflict.binary && (
          <Warning>El conflicto afecta a un archivo binario; elige un lado o edítalo en tu editor.</Warning>
        )}
        {conflictFile && !conflictFile.conflicted && (
          <div className="muted">Este archivo ya no está en conflicto.</div>
        )}
        {conflictFile?.conflicted && (
          <div className="conflict-actions">
            <button
              className="small-button"
              onClick={() => onResolveSide(conflictFile, "ours")}
            >
              Usar nuestro lado
            </button>
            <button
              className="small-button"
              onClick={() => onResolveSide(conflictFile, "theirs")}
            >
              Usar su lado
            </button>
            <button className="small-button" onClick={() => onMarkResolved(conflictFile)}>
              <Check size={12} /> Marcar resuelto
            </button>
          </div>
        )}
        <div className="conflict-columns">
          <div className="conflict-side">
            <h4>{conflict.oursLabel}</h4>
            <pre>{conflict.ours || "(lado vacío o eliminado)"}</pre>
          </div>
          <div className="conflict-side">
            <h4>{conflict.theirsLabel}</h4>
            <pre>{conflict.theirs || "(lado vacío o eliminado)"}</pre>
          </div>
        </div>
      </div>
    );
  }
  return (
    <DiffView
      diff={diff}
      filePath={selectedFile?.path ?? null}
      oldPath={selectedFile?.oldPath}
      loading={diffLoading}
      mode={diffMode === "commit" ? "unstaged" : diffMode}
      onApplyPatch={diffMode === "commit" ? undefined : onApplyPatch}
      onShowBlame={onBlame ? () => selectedFile && onBlame(selectedFile.path) : undefined}
      onShowHistory={onHistory ? () => selectedFile && onHistory(selectedFile.path) : undefined}
    />
  );
}

function CommitBox({
  repo,
  status,
  summary,
  description,
  amend,
  sign,
  committing,
  onSummaryChange,
  onDescriptionChange,
  onAmendChange,
  onSignChange,
  onCommit,
}: RightPanelProps) {
  const identityMissing = !repo.identityName || !repo.identityEmail;
  const canCommit =
    !identityMissing &&
    !committing &&
    summary.trim().length > 0 &&
    (status.staged.length > 0 || amend);
  return (
    <div className="commit-box">
      {identityMissing && (
        <Warning>
          <strong>Falta la identidad de Git.</strong> Leviathan no define user.name ni user.email por ti.
          Configúralos en tu terminal:
          <code>git config --global user.name "Tu Nombre"</code>
          <code>git config --global user.email "tu@correo.com"</code>
        </Warning>
      )}
      <input
        className="commit-summary"
        value={summary}
        onChange={(event) => onSummaryChange(event.target.value)}
        placeholder="Resumen del commit"
        disabled={committing}
        spellCheck={false}
      />
      <textarea
        className="commit-description"
        value={description}
        onChange={(event) => onDescriptionChange(event.target.value)}
        placeholder="Descripción (opcional)"
        rows={2}
        disabled={committing}
      />
      <div className="commit-options">
        <label className="mini-check">
          <input type="checkbox" checked={amend} onChange={(event) => onAmendChange(event.target.checked)} disabled={!repo.hasCommits || committing} />
          Amend
        </label>
        <label className="mini-check" title={repo.signConfigured ? "Tu configuración de Git ya firma commits" : "Firmar con la clave configurada en Git"}>
          <input type="checkbox" checked={sign} onChange={(event) => onSignChange(event.target.checked)} disabled={committing} />
          Firmar (-S)
        </label>
        <span className="commit-box-spacer" />
        <span className="commit-hint">
          {status.staged.length > 0
            ? `${status.staged.length} preparado${status.staged.length === 1 ? "" : "s"}`
            : amend
              ? "Solo cambia el commit"
              : "Prepara archivos para confirmar"}
        </span>
        <button className="primary-button" onClick={onCommit} disabled={!canCommit}>
          {committing ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          {amend ? "Enmendar" : "Commit"}
        </button>
      </div>
      {status.conflicted.length > 0 && (
        <div className="commit-conflict-hint">
          Quedan {status.conflicted.length} conflicto(s). Resuélvelos y prepáralos antes de confirmar.
        </div>
      )}
    </div>
  );
}

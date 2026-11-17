import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CloudDownload,
  Copy,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Branch } from "../lib/types";
import { Modal, Warning } from "./ui";

async function pickDirectory(title: string): Promise<string | null> {
  try {
    const result = await openDialog({ directory: true, multiple: false, title });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

export function RepoDialog({
  recents,
  initialTab = "open",
  onOpen,
  onInit,
  onClone,
  onRemoveRecent,
  onClose,
}: {
  recents: string[];
  initialTab?: "open" | "init" | "clone";
  onOpen: (path: string) => void;
  onInit: (path: string) => void;
  onClone: (url: string, destination: string) => void;
  onRemoveRecent: (path: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"open" | "init" | "clone">(initialTab);
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState("");

  const choose = async (setter: (value: string) => void, title: string) => {
    const selected = await pickDirectory(title);
    if (selected) setter(selected);
  };

  const suggestedName = (() => {
    const cleaned = url.trim().replace(/\.git$/i, "").replace(/[\\/]+$/, "");
    if (!cleaned) return "";
    const parts = cleaned.split(/[\\/:]/);
    return parts[parts.length - 1] || "";
  })();

  return (
    <Modal
      title="Abrir repositorio"
      subtitle="Elige un repositorio existente, inicializa uno nuevo o clona uno."
      onClose={onClose}
      wide
    >
      <div className="dialog-tabs">
        <button className={tab === "open" ? "is-active" : ""} onClick={() => setTab("open")}>Abrir</button>
        <button className={tab === "init" ? "is-active" : ""} onClick={() => setTab("init")}>Inicializar</button>
        <button className={tab === "clone" ? "is-active" : ""} onClick={() => setTab("clone")}>Clonar</button>
      </div>

      {tab === "open" && (
        <div className="dialog-content">
          <div className="inline-field">
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="Ruta del repositorio (o de una carpeta dentro de él)"
              spellCheck={false}
              autoFocus
            />
            <button className="small-button" onClick={() => choose(setPath, "Elegir repositorio")}>
              <FolderOpen size={13} /> Examinar
            </button>
            <button className="primary-button" disabled={!path.trim()} onClick={() => onOpen(path.trim())}>
              Abrir
            </button>
          </div>

          <div className="recents">
            <h3>Recientes</h3>
            {recents.length === 0 ? (
              <p className="muted">Todavía no hay repositorios recientes. Esta lista es lo único que guarda la app.</p>
            ) : (
              recents.map((recent) => (
                <div className="recent-row" key={recent}>
                  <button className="recent-main" onClick={() => onOpen(recent)} title={recent}>
                    <GitBranch size={13} />
                    <span className="recent-name">{recent.split(/[\\/]/).filter(Boolean).pop()}</span>
                    <span className="recent-path">{recent}</span>
                  </button>
                  <button className="micro-button" onClick={() => onRemoveRecent(recent)} title="Quitar de recientes">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "init" && (
        <div className="dialog-content">
          <p className="muted">Se ejecutará <code>git init</code> en la carpeta elegida. No se modifica tu configuración global.</p>
          <div className="inline-field">
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="Carpeta para el nuevo repositorio"
              spellCheck={false}
              autoFocus
            />
            <button className="small-button" onClick={() => choose(setPath, "Elegir carpeta")}>
              <FolderOpen size={13} /> Examinar
            </button>
            <button className="primary-button" disabled={!path.trim()} onClick={() => onInit(path.trim())}>
              <Plus size={14} /> Inicializar
            </button>
          </div>
        </div>
      )}

      {tab === "clone" && (
        <div className="dialog-content">
          <label className="field">
            <span className="field-label">URL del repositorio</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://… o git@… o una ruta local"
              spellCheck={false}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Carpeta de destino</span>
            <div className="inline-field">
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="Carpeta donde quedará el clon"
                spellCheck={false}
              />
              <button
                className="small-button"
                onClick={async () => {
                  const parent = await pickDirectory("Elegir carpeta contenedora");
                  if (parent) {
                    const name = suggestedName || "repositorio";
                    const separator = parent.includes("\\") ? "\\" : "/";
                    setDestination(`${parent.replace(/[\\/]+$/, "")}${separator}${name}`);
                  }
                }}
              >
                <FolderOpen size={13} /> Examinar
              </button>
            </div>
            <span className="field-hint">Debe ser una carpeta nueva o vacía. Git resolverá las credenciales con tu configuración.</span>
          </label>
          <div className="dialog-actions">
            <button className="primary-button" disabled={!url.trim() || !destination.trim()} onClick={() => onClone(url.trim(), destination.trim())}>
              <CloudDownload size={14} /> Clonar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export interface FormField {
  key: string;
  label: string;
  initial?: string;
  placeholder?: string;
  hint?: string;
  textarea?: boolean;
  required?: boolean;
}

export interface FormCheck {
  key: string;
  label: string;
  hint?: string;
  initial?: boolean;
}

export function TextFormDialog({
  title,
  subtitle,
  fields,
  checks,
  submitLabel,
  danger,
  note,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  fields: FormField[];
  checks?: FormCheck[];
  submitLabel: string;
  danger?: boolean;
  note?: ReactNode;
  onSubmit: (values: Record<string, string>, checks: Record<string, boolean>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.initial ?? ""])),
  );
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((checks ?? []).map((check) => [check.key, check.initial ?? false])),
  );
  const valid = fields.every((field) => !field.required || values[field.key]?.trim());

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <button className="small-button" onClick={onClose}>Cancelar</button>
          <button
            className={danger ? "danger-button" : "primary-button"}
            disabled={!valid}
            onClick={() => onSubmit(values, checked)}
          >
            {submitLabel}
          </button>
        </>
      }
    >
      {note}
      {fields.map((field) => (
        <label className="field" key={field.key}>
          <span className="field-label">{field.label}</span>
          {field.textarea ? (
            <textarea
              value={values[field.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              placeholder={field.placeholder}
              rows={4}
              autoFocus={field === fields[0]}
            />
          ) : (
            <input
              value={values[field.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              placeholder={field.placeholder}
              spellCheck={false}
              autoFocus={field === fields[0]}
            />
          )}
          {field.hint && <span className="field-hint">{field.hint}</span>}
        </label>
      ))}
      {(checks ?? []).map((check) => (
        <label className="checkbox" key={check.key}>
          <input
            type="checkbox"
            checked={checked[check.key] ?? false}
            onChange={(event) => setChecked((current) => ({ ...current, [check.key]: event.target.checked }))}
          />
          <span>
            <strong>{check.label}</strong>
            {check.hint && <small>{check.hint}</small>}
          </span>
        </label>
      ))}
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  consequences,
  confirmLabel,
  danger,
  acknowledge,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  consequences?: string[];
  confirmLabel: string;
  danger?: boolean;
  acknowledge?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [accepted, setAccepted] = useState(!acknowledge);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="small-button" onClick={onClose}>Cancelar</button>
          <button
            className={danger ? "danger-button" : "primary-button"}
            disabled={!accepted}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
      {consequences && consequences.length > 0 && (
        <ul className="consequences">
          {consequences.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {acknowledge && (
        <label className="checkbox">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span><strong>{acknowledge}</strong></span>
        </label>
      )}
    </Modal>
  );
}

export function MergeDialog({
  branches,
  currentBranch,
  mergeInProgress,
  onMerge,
  onAbort,
  onClose,
}: {
  branches: Branch[];
  currentBranch: string | null;
  mergeInProgress: boolean;
  onMerge: (target: string, noFf: boolean, squash: boolean, message: string) => void;
  onAbort: () => void;
  onClose: () => void;
}) {
  const candidates = branches.filter(
    (branch) => !(branch.isCurrent && branch.name === currentBranch),
  );
  const [target, setTarget] = useState(candidates[0]?.fullName ?? "");
  const [noFf, setNoFf] = useState(false);
  const [squash, setSquash] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <Modal
      title="Merge"
      subtitle={`Fusionar en ${currentBranch ?? "HEAD"}`}
      onClose={onClose}
      footer={
        <>
          {mergeInProgress && (
            <button className="danger-button" onClick={onAbort}>
              <AlertTriangle size={13} /> Abortar merge
            </button>
          )}
          <span className="modal-footer-spacer" />
          <button className="small-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" disabled={!target} onClick={() => onMerge(target, noFf, squash, message)}>
            Hacer merge
          </button>
        </>
      }
    >
      {mergeInProgress && (
        <Warning>Hay un merge en curso. Puedes abortarlo, o terminar de resolver los conflictos y confirmar desde el panel de cambios.</Warning>
      )}
      <label className="field">
        <span className="field-label">Rama o commit a fusionar</span>
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          {candidates.map((branch) => (
            <option key={branch.fullName} value={branch.fullName}>
              {branch.isRemote ? `${branch.remote}/${branch.name}` : branch.name}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={noFf} onChange={(event) => setNoFf(event.target.checked)} />
        <span><strong>Crear siempre un commit de merge (--no-ff)</strong><small>Conserva explícitamente el punto de bifurcación.</small></span>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={squash} onChange={(event) => setSquash(event.target.checked)} />
        <span><strong>Squash (--squash)</strong><small>Deja los cambios preparados sin crear el commit de merge.</small></span>
      </label>
      <label className="field">
        <span className="field-label">Mensaje (opcional)</span>
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Mensaje del commit de merge" />
      </label>
    </Modal>
  );
}

export function RebaseDialog({
  branches,
  currentBranch,
  rebaseInProgress,
  defaultTarget,
  onRebase,
  onAbort,
  onClose,
}: {
  branches: Branch[];
  currentBranch: string | null;
  rebaseInProgress: boolean;
  defaultTarget?: string;
  onRebase: (target: string) => void;
  onAbort: () => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(defaultTarget ?? branches.find((branch) => !branch.isCurrent)?.fullName ?? "");
  return (
    <Modal
      title="Rebase"
      subtitle={`Reaplicar ${currentBranch ?? "HEAD"} sobre otra referencia`}
      onClose={onClose}
      footer={
        <>
          {rebaseInProgress && <button className="danger-button" onClick={onAbort}>Abortar rebase</button>}
          <span className="modal-footer-spacer" />
          <button className="small-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" disabled={!target} onClick={() => onRebase(target)}>Hacer rebase</button>
        </>
      }
    >
      {rebaseInProgress && <Warning>Hay un rebase en curso. Abortarlo devuelve la rama a su estado anterior.</Warning>}
      <label className="field">
        <span className="field-label">Rebase sobre</span>
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          {branches
            .filter((branch) => !branch.isCurrent)
            .map((branch) => (
              <option key={branch.fullName} value={branch.fullName}>
                {branch.isRemote ? `${branch.remote}/${branch.name}` : branch.name}
              </option>
            ))}
        </select>
      </label>
      <p className="muted">El rebase reescribe los commits de la rama actual. Es una operación local; puedes abortar si hay conflictos.</p>
    </Modal>
  );
}

export function ResetDialog({
  rev,
  shortHash,
  onReset,
  onClose,
}: {
  rev: string;
  shortHash: string;
  onReset: (mode: "soft" | "mixed" | "hard") => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"soft" | "mixed" | "hard">("mixed");
  const [accepted, setAccepted] = useState(false);
  return (
    <Modal
      title="Reset"
      subtitle={`Mover HEAD a ${shortHash}`}
      onClose={onClose}
      footer={
        <>
          <button className="small-button" onClick={onClose}>Cancelar</button>
          <button
            className="danger-button"
            disabled={mode === "hard" && !accepted}
            onClick={() => onReset(mode)}
          >
            Hacer reset --{mode}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Modo</span>
        <select value={mode} onChange={(event) => setMode(event.target.value as "soft" | "mixed" | "hard")}>
          <option value="soft">--soft: mueve HEAD, conserva índice y archivos</option>
          <option value="mixed">--mixed: mueve HEAD y el índice, conserva archivos</option>
          <option value="hard">--hard: mueve HEAD y descarta índice y cambios del árbol</option>
        </select>
      </label>
      {mode === "hard" ? (
        <>
          <Warning>Un reset --hard descarta los cambios sin confirmar y los archivos preparados. Esta acción no se puede recuperar desde el árbol de trabajo.</Warning>
          <label className="checkbox">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span><strong>Entiendo que se perderán los cambios no confirmados.</strong></span>
          </label>
        </>
      ) : (
        <p className="muted">Los cambios no confirmados se conservarán en el árbol de trabajo.</p>
      )}
    </Modal>
  );
}

export interface OperationState {
  id: string;
  title: string;
  log: string;
  cancelling: boolean;
}

export function OperationOverlay({
  operation,
  onCancel,
}: {
  operation: OperationState;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal operation-modal">
        <header className="modal-header">
          <div>
            <h2><Loader2 size={17} className="spin" /> {operation.title}</h2>
            <p>La operación se ejecuta con el git de tu sistema.</p>
          </div>
        </header>
        <div className="operation-log">
          {operation.log || "Esperando salida de Git…"}
        </div>
        <footer className="modal-footer">
          <span className="muted">Puedes cancelar; el proceso de Git se detendrá.</span>
          <span className="modal-footer-spacer" />
          <button className="danger-button" onClick={onCancel} disabled={operation.cancelling}>
            {operation.cancelling ? <Loader2 size={13} className="spin" /> : null}
            Cancelar operación
          </button>
        </footer>
      </div>
    </div>
  );
}

export function ErrorDialog({
  title = "Git devolvió un error",
  message,
  detail,
  onClose,
}: {
  title?: string;
  message: string;
  detail?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const authHint =
    detail &&
    /could not read Username|Authentication failed|Permission denied \(publickey\)|terminal prompts disabled|askpass/i.test(detail);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${message}\n\n${detail ?? ""}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin permiso de portapapeles.
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="small-button" onClick={copy}>
            <Copy size={13} /> {copied ? "Copiado" : "Copiar"}
          </button>
          <span className="modal-footer-spacer" />
          <button className="primary-button" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <p className="error-message">{message}</p>
      {authHint && (
        <Warning>
          Git pidió credenciales y la app no puede responder por ti. Abre la terminal integrada y ejecuta el comando
          allí, o configura un credential helper/SSH agent en tu Git. La app no guarda credenciales.
        </Warning>
      )}
      {detail && <pre className="error-detail">{detail}</pre>}
    </Modal>
  );
}

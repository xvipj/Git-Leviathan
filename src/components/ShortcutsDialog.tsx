import { useState } from "react";
import {
  SHORTCUT_ACTIONS,
  normalizeShortcut,
  type ShortcutMap,
} from "../lib/layout";
import { Modal } from "./ui";

interface ShortcutsDialogProps {
  shortcuts: ShortcutMap;
  onSave: (shortcuts: ShortcutMap) => void;
  onClose: () => void;
}

export function ShortcutsDialog({
  shortcuts,
  onSave,
  onClose,
}: ShortcutsDialogProps) {
  const [draft, setDraft] = useState<ShortcutMap>({ ...shortcuts });
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const next = {} as ShortcutMap;
    const seen = new Set<string>();
    for (const action of SHORTCUT_ACTIONS) {
      const normalized = normalizeShortcut(draft[action.id]);
      if (!normalized) {
        setError(
          `«${draft[action.id]}» no es un atajo válido. Usa al menos un modificador, por ejemplo Ctrl+B.`,
        );
        return;
      }
      if (seen.has(normalized)) {
        setError(`El atajo ${normalized} está asignado a dos acciones.`);
        return;
      }
      seen.add(normalized);
      next[action.id] = normalized;
    }
    onSave(next);
    onClose();
  };

  return (
    <Modal
      title="Atajos de teclado"
      subtitle="Haz clic en un campo y pulsa la combinación. Los cambios se guardan con el diseño de la app."
      onClose={onClose}
      footer={
        <>
          <button className="small-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" onClick={save}>
            Guardar atajos
          </button>
        </>
      }
    >
      <div className="shortcut-list">
        {SHORTCUT_ACTIONS.map((action) => (
          <label className="shortcut-row" key={action.id}>
            <span className="shortcut-info">
              <strong>{action.label}</strong>
              <span className="muted">{action.hint}</span>
            </span>
            <input
              className="shortcut-input mono"
              value={draft[action.id]}
              onChange={(event) => {
                setError(null);
                const value = event.target.value;
                setDraft((current) => ({
                  ...current,
                  [action.id]: value,
                }));
              }}
              onKeyDown={(event) => {
                if (["Tab", "Escape", "Enter"].includes(event.key)) return;
                if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
                event.preventDefault();
                const parts: string[] = [];
                if (event.ctrlKey) parts.push("Ctrl");
                if (event.altKey) parts.push("Alt");
                if (event.shiftKey) parts.push("Shift");
                if (event.metaKey) parts.push("Meta");
                if (parts.length === 0) return;
                const key =
                  event.key.length === 1 ? event.key.toUpperCase() : event.key;
                const value = [...parts, key].join("+");
                if (!normalizeShortcut(value)) return;
                setError(null);
                setDraft((current) => ({
                  ...current,
                  [action.id]: value,
                }));
              }}
              spellCheck={false}
              aria-label={`Atajo para ${action.label}`}
            />
          </label>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

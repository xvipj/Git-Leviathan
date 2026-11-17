import { useEffect, type ReactNode } from "react";
import { X, AlertTriangle, Loader2 } from "lucide-react";

export function IconButton({
  children,
  label,
  onClick,
  disabled,
  active,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  wide,
  closeLabel = "Cerrar",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeLabel?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true">
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label={closeLabel} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`checkbox ${disabled ? "is-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="warning-box">
      <AlertTriangle size={16} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Badge({
  children,
  kind = "default",
  title,
}: {
  children: ReactNode;
  kind?: "default" | "branch" | "remote" | "tag" | "head" | "status";
  title?: string;
}) {
  return (
    <span className={`badge badge-${kind}`} title={title}>
      {children}
    </span>
  );
}

export interface ToastItem {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
  detail?: string;
  onDetail?: () => void;
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-host">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <div className="toast-content">
            <strong>{toast.message}</strong>
            {toast.detail && <span className="toast-detail">{toast.detail}</span>}
          </div>
          {toast.onDetail && (
            <button className="link-button" onClick={toast.onDetail}>
              Ver detalle
            </button>
          )}
          <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Cerrar aviso">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

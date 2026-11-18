import type { ReactNode } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { IconButton } from "./ui";

export interface RailItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface PanelRailProps {
  side: "left" | "right";
  items: RailItem[];
  label: string;
  visible: boolean;
  expanded?: boolean;
  onExpand: () => void;
  onOpen: (id: string) => void;
}

/** Barra estrecha que queda visible cuando un panel lateral está plegado. */
export function PanelRail({
  side,
  items,
  label,
  visible,
  expanded = false,
  onExpand,
  onOpen,
}: PanelRailProps) {
  return (
    <nav
      className={`panel-rail ${side}`}
      aria-label={label}
      aria-hidden={!visible}
      inert={!visible}
    >
      <IconButton
        label={expanded ? `Cerrar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
        className="rail-expand"
        expanded={expanded}
        onClick={onExpand}
      >
        {side === "left" ? <PanelLeftOpen size={17} /> : <PanelRightOpen size={17} />}
      </IconButton>
      <span className="rail-separator" aria-hidden="true" />
      {items.map((item) => (
        <IconButton
          key={item.id}
          label={item.label}
          className="rail-button"
          onClick={() => onOpen(item.id)}
        >
          {item.icon}
        </IconButton>
      ))}
    </nav>
  );
}

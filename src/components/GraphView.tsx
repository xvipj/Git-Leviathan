import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  GitCommit,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { CommitEntry, HistoryKind } from "../lib/types";
import { avatarColor, initials, relativeTime } from "../lib/format";
import { computeGraph, GRAPH_COLORS } from "../lib/graph";
import { Badge, IconButton } from "./ui";

const ROW_HEIGHT = 36;
const GRAPH_LEFT = 172;
const GRAPH_WIDTH = 232;
const AVATAR = 22;

export interface ScrollTarget {
  hash: string;
  nonce: number;
}

interface GraphViewProps {
  commits: CommitEntry[];
  hasMore: boolean;
  loading: boolean;
  selectedHash: string | null;
  onSelectCommit: (commit: CommitEntry) => void;
  onSelectWip: () => void;
  wipSelected: boolean;
  wipCount: number;
  wipStaged: number;
  wipUnstaged: number;
  wipConflicts: number;
  highlightName: string | null;
  onClearHighlight: () => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  scrollTarget: ScrollTarget | null;
  searchQuery: string;
  searchKind: HistoryKind;
  activeFilterQuery: string | null;
  onSearchQueryChange: (value: string) => void;
  onSearchKindChange: (value: HistoryKind) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onContextMenu: (commit: CommitEntry, event: React.MouseEvent) => void;
}

export function GraphView({
  commits,
  hasMore,
  loading,
  selectedHash,
  onSelectCommit,
  onSelectWip,
  wipSelected,
  wipCount,
  wipStaged,
  wipUnstaged,
  wipConflicts,
  highlightName,
  onClearHighlight,
  onLoadMore,
  onRefresh,
  scrollTarget,
  searchQuery,
  searchKind,
  activeFilterQuery,
  onSearchQueryChange,
  onSearchKindChange,
  onSearch,
  onClearSearch,
  onContextMenu,
}: GraphViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 900, height: 600 });
  const loadGuard = useRef(false);
  const layout = useMemo(() => computeGraph(commits), [commits]);
  const totalHeight = commits.length * ROW_HEIGHT;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    });
    observer.observe(element);
    setViewport({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    loadGuard.current = loading;
  }, [loading]);

  const lastScrollNonce = useRef(0);
  useEffect(() => {
    if (!scrollTarget || scrollTarget.nonce === lastScrollNonce.current) return;
    const index = commits.findIndex((commit) => commit.hash === scrollTarget.hash);
    const element = scrollRef.current;
    if (index >= 0 && element) {
      lastScrollNonce.current = scrollTarget.nonce;
      element.scrollTop = Math.max(0, index * ROW_HEIGHT - element.clientHeight / 2 + ROW_HEIGHT / 2);
    }
  }, [scrollTarget, commits]);

  const maxLane = Math.max(layout.width, 1);
  const step = Math.max(8, Math.min(14, (GRAPH_WIDTH - 26) / Math.max(maxLane, 1)));
  const centerX = (lane: number) => 16 + lane * step;
  const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8);
  const visibleEnd = Math.min(
    commits.length,
    Math.ceil((scrollTop + viewport.height) / ROW_HEIGHT) + 8,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(GRAPH_WIDTH * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${GRAPH_WIDTH}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, GRAPH_WIDTH, viewport.height);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    const color = (lane: number) => GRAPH_COLORS[lane % GRAPH_COLORS.length];
    const drawEdge = (
      from: number,
      to: number,
      y0: number,
      y1: number,
      laneColor: number,
    ) => {
      ctx.strokeStyle = color(laneColor);
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      const x0 = centerX(from);
      const x1 = centerX(to);
      if (x0 === x1) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      } else {
        const mid = (y1 - y0) / 2;
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo(x0, y0 + mid, x1, y1 - mid, x1, y1);
      }
      ctx.stroke();
    };

    for (let index = Math.max(0, visibleStart - 1); index <= Math.min(commits.length - 1, visibleEnd); index += 1) {
      const row = layout.rows[index];
      if (!row) continue;
      const y0 = index * ROW_HEIGHT - scrollTop;
      const center = y0 + ROW_HEIGHT / 2;
      const bottom = y0 + ROW_HEIGHT;
      for (const edge of row.incoming) {
        drawEdge(edge.from, edge.to, y0, center, edge.color);
      }
      for (const edge of row.outgoing) {
        drawEdge(edge.from, edge.to, center, bottom, edge.color);
      }
    }

    for (let index = visibleStart; index < visibleEnd; index += 1) {
      const row = layout.rows[index];
      if (!row) continue;
      const center = index * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
      const x = centerX(row.lane);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, center, selectedHash === commits[index]?.hash ? 7 : 5.4, 0, Math.PI * 2);
      ctx.fillStyle = color(row.color);
      ctx.fill();
      ctx.lineWidth = selectedHash === commits[index]?.hash ? 2.5 : 2;
      ctx.strokeStyle = selectedHash === commits[index]?.hash ? "#f4f7fb" : "#0f131a";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [layout, scrollTop, viewport.height, selectedHash, commits, step]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    setScrollTop(element.scrollTop);
    if (
      hasMore &&
      !loadGuard.current &&
      element.scrollTop + element.clientHeight >= totalHeight - 700
    ) {
      loadGuard.current = true;
      onLoadMore();
      window.setTimeout(() => {
        loadGuard.current = false;
      }, 500);
    }
  };

  const noResults = commits.length === 0 && !loading;

  return (
    <section className="graph-panel">
      <div className="graph-toolbar">
        <div className="graph-search">
          <Search size={14} />
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearch();
            }}
            placeholder="Buscar en el historial…"
            spellCheck={false}
          />
          <select
            value={searchKind}
            onChange={(event) => onSearchKindChange(event.target.value as HistoryKind)}
            title="Campo de búsqueda"
          >
            <option value="message">Mensaje</option>
            <option value="author">Autor</option>
            <option value="file">Archivo</option>
            <option value="hash">Hash</option>
          </select>
          <button className="small-button" onClick={onSearch}>
            Buscar
          </button>
        </div>
        {activeFilterQuery && (
          <div className="active-search">
            <span>
              Filtro: <strong>{activeFilterQuery}</strong>
            </span>
            <button onClick={onClearSearch} title="Quitar filtro">
              <X size={12} />
            </button>
          </div>
        )}
        {highlightName && (
          <button className="highlight-chip" onClick={onClearHighlight}>
            <span className="branch-dot" /> {highlightName} <X size={11} />
          </button>
        )}
        <div className="graph-toolbar-spacer" />
        <span className="graph-count">
          {commits.length.toLocaleString("es")}
          {hasMore ? "+" : ""} commits
        </span>
        <IconButton label="Refrescar historial" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
        </IconButton>
      </div>

      <div className="graph-body">
        <button
          className={`wip-row ${wipSelected ? "is-selected" : ""}`}
          onClick={onSelectWip}
          title="Cambios sin confirmar"
        >
          <div className="commit-refs">
            <Badge kind="status">WIP</Badge>
          </div>
          <div className="wip-graph-space">
            <span className="wip-graph-line" />
            <span className="wip-node" />
          </div>
          <div className="wip-main">
            <span className="wip-title">Cambios sin confirmar</span>
            <span className="wip-meta">
              {wipCount === 0
                ? "Árbol de trabajo limpio"
                : `${wipCount} archivo${wipCount === 1 ? "" : "s"} · ${wipStaged} preparado${
                    wipStaged === 1 ? "" : "s"
                  } · ${wipUnstaged} sin preparar`}
              {wipConflicts > 0 ? ` · ${wipConflicts} en conflicto` : ""}
            </span>
          </div>
          <span className="wip-hash">WIP</span>
        </button>

        <div className="graph-scroll-wrap">
          <div className="graph-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className="graph-spacer" style={{ height: totalHeight }}>
              {commits.slice(visibleStart, visibleEnd).map((commit, offset) => {
                const index = visibleStart + offset;
                const top = index * ROW_HEIGHT;
                const highlighted = Boolean(
                  highlightName &&
                    commit.refs.some((ref) => ref.name === highlightName),
                );
                return (
                  <div
                    key={commit.hash}
                    className={`commit-row ${selectedHash === commit.hash ? "is-selected" : ""} ${
                      highlighted ? "is-highlighted" : ""
                    }`}
                    style={{ top, height: ROW_HEIGHT }}
                    onClick={() => onSelectCommit(commit)}
                    onContextMenu={(event) => onContextMenu(commit, event)}
                    title={`${commit.subject}\n${commit.authorName} · ${relativeTime(commit.time)}`}
                  >
                    <div className="commit-refs">
                      {commit.refs.slice(0, 2).map((ref) => (
                        <Badge
                          key={`${ref.kind}-${ref.name}`}
                          kind={
                            ref.kind === "branch"
                              ? "branch"
                              : ref.kind === "remote"
                                ? "remote"
                                : ref.kind === "tag"
                                  ? "tag"
                                  : "head"
                          }
                        >
                          {ref.name}
                        </Badge>
                      ))}
                      {commit.refs.length > 2 && <Badge>+{commit.refs.length - 2}</Badge>}
                    </div>
                    <div className="commit-graph-space" />
                    <div className="commit-main">
                      <span
                        className="avatar"
                        style={{ background: avatarColor(commit.authorName), width: AVATAR, height: AVATAR }}
                        aria-hidden="true"
                      >
                        {initials(commit.authorName)}
                      </span>
                      <div className="commit-text">
                        <span className="commit-subject">{commit.subject}</span>
                        <span className="commit-author">{commit.authorName}</span>
                      </div>
                      <span className="commit-hash">{commit.shortHash}</span>
                      <span className="commit-date">{relativeTime(commit.time)}</span>
                    </div>
                  </div>
                );
              })}
              {loading && commits.length === 0 && (
                <div className="graph-loading">
                  <Loader2 size={18} className="spin" /> Cargando historial…
                </div>
              )}
              {loading && commits.length > 0 && (
                <div className="graph-loading-more" style={{ top: totalHeight }}>
                  <Loader2 size={16} className="spin" /> Cargando más commits…
                </div>
              )}
              {noResults && (
                <div className="graph-empty">
                  <GitCommit size={26} />
                  <strong>
                    {activeFilterQuery ? "Sin resultados para la búsqueda" : "Todavía no hay commits"}
                  </strong>
                  <p>
                    {activeFilterQuery
                      ? "Prueba con otro término o cambia el campo de búsqueda."
                      : "Haz tu primer commit desde el panel de cambios sin confirmar."}
                  </p>
                </div>
              )}
            </div>
          </div>
          <canvas
            ref={canvasRef}
            className="graph-canvas"
            style={{ left: GRAPH_LEFT, width: GRAPH_WIDTH, height: viewport.height }}
          />
        </div>
      </div>
    </section>
  );
}

export function GraphLegend() {
  return (
    <div className="graph-legend">
      <ChevronDown size={11} /> Arrastra o usa la rueda para navegar
    </div>
  );
}

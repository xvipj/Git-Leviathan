import type { CommitEntry } from "./types";

export const GRAPH_COLORS = [
  "#44e2cd",
  "#8270ff",
  "#ff8a5c",
  "#f7c948",
  "#56a8ff",
  "#ff6b9d",
  "#7bd88f",
  "#c084fc",
  "#f97316",
  "#38bdf8",
  "#fb7185",
  "#a3e635",
];

export interface GraphEdge {
  from: number;
  to: number;
  color: number;
}

export interface GraphRow {
  lane: number;
  color: number;
  incoming: GraphEdge[];
  outgoing: GraphEdge[];
  width: number;
}

export interface GraphLayout {
  rows: GraphRow[];
  width: number;
}

function freeLane(lanes: Array<string | null>, after: number): number {
  for (let i = Math.max(after + 1, 0); i < lanes.length; i += 1) {
    if (lanes[i] === null) return i;
  }
  for (let i = 0; i < lanes.length; i += 1) {
    if (lanes[i] === null) return i;
  }
  lanes.push(null);
  return lanes.length - 1;
}

/**
 * Distribuye los commits en carriles. Los commits deben venir en orden
 * topológico (como los entrega `git log --topo-order`).
 */
export function computeGraph(commits: CommitEntry[]): GraphLayout {
  const lanes: Array<string | null> = [];
  const rows: GraphRow[] = [];
  let maxWidth = 1;

  for (const commit of commits) {
    const matching: number[] = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === commit.hash) matching.push(i);
    }

    let cur: number;
    if (matching.length > 0) {
      cur = matching[0];
    } else {
      cur = freeLane(lanes, -1);
    }
    lanes[cur] = commit.hash;

    const incoming: GraphEdge[] = [];
    const outgoing: GraphEdge[] = [];
    const touched = new Set<number>([cur]);

    // Convergencia de varias ramas en este mismo commit.
    for (const lane of matching) {
      incoming.push({ from: lane, to: cur, color: lane });
      touched.add(lane);
      if (lane !== cur) lanes[lane] = null;
    }
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === null) continue;
      touched.add(i);
      if (i === cur) {
        incoming.push({ from: i, to: cur, color: cur });
      } else if (lanes[i] === commit.hash) {
        incoming.push({ from: i, to: cur, color: i });
      } else {
        incoming.push({ from: i, to: i, color: i });
      }
    }

    // El carril del commit queda libre antes de colocar a sus padres.
    lanes[cur] = null;
    const createdLanes = new Set<number>();

    const firstParent = commit.parents[0];
    if (firstParent) {
      const existing = lanes.findIndex((lane) => lane === firstParent);
      if (existing >= 0) {
        outgoing.push({ from: cur, to: existing, color: existing });
        touched.add(existing);
      } else {
        lanes[cur] = firstParent;
        outgoing.push({ from: cur, to: cur, color: cur });
      }
    }

    for (const parent of commit.parents.slice(1)) {
      const existing = lanes.findIndex((lane) => lane === parent);
      if (existing >= 0) {
        outgoing.push({ from: cur, to: existing, color: existing });
        touched.add(existing);
      } else {
        const lane = freeLane(lanes, cur);
        lanes[lane] = parent;
        touched.add(lane);
        createdLanes.add(lane);
        outgoing.push({ from: cur, to: lane, color: lane });
      }
    }

    // Los carriles que no participan en este commit continúan rectos.
    // Los carriles recién creados se conectan solo con la diagonal del merge.
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === null || i === cur || createdLanes.has(i)) continue;
      touched.add(i);
      outgoing.push({ from: i, to: i, color: i });
    }

    // Deduplicar por (from,to) conservando el primer color.
    const seenIn = new Set<string>();
    const uniqIn = incoming.filter((edge) => {
      const key = `${edge.from}:${edge.to}`;
      if (seenIn.has(key)) return false;
      seenIn.add(key);
      return true;
    });
    const seenOut = new Set<string>();
    const uniqOut = outgoing.filter((edge) => {
      const key = `${edge.from}:${edge.to}`;
      if (seenOut.has(key)) return false;
      seenOut.add(key);
      return true;
    });

    const width = Math.max(...Array.from(touched), 0) + 1;
    maxWidth = Math.max(maxWidth, width);
    rows.push({
      lane: cur,
      color: cur,
      incoming: uniqIn,
      outgoing: uniqOut,
      width,
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
  }

  return { rows, width: maxWidth };
}

export interface DiffLine {
  type: " " | "+" | "-" | "\\";
  text: string;
  raw: string;
  oldLine: number | null;
  newLine: number | null;
  index: number;
}

export interface DiffHunk {
  header: string;
  section: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffFile {
  header: string[];
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
  binary: boolean;
  combined: boolean;
  raw: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  const rawLines: string[] = [];

  const finish = () => {
    if (current) {
      current.raw = rawLines.splice(0).join("\n");
      files.push(current);
    }
    current = null;
    hunk = null;
  };

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === lines.length - 1 && line === "") continue;

    if (line.startsWith("diff --git ")) {
      finish();
      current = {
        header: [line],
        oldPath: null,
        newPath: null,
        hunks: [],
        binary: false,
        combined: false,
        raw: "",
      };
      rawLines.length = 0;
      rawLines.push(line);
      continue;
    }
    rawLines.push(line);

    if (!current) {
      if (line.startsWith("--- ") || line.startsWith("Binary files ")) {
        current = {
          header: [],
          oldPath: null,
          newPath: null,
          hunks: [],
          binary: false,
          combined: false,
          raw: "",
        };
      } else {
        continue;
      }
    }

    if (line.startsWith("--- ") && hunk === null) {
      if (!current.header.includes(line)) current.header.push(line);
      current.oldPath = parsePath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ") && hunk === null) {
      if (!current.header.includes(line)) current.header.push(line);
      current.newPath = parsePath(line.slice(4));
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("Binary file ")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("@@@")) {
      current.combined = true;
      hunk = null;
      continue;
    }
    const match = HUNK_RE.exec(line);
    if (match) {
      const parsed: DiffHunk = {
        header: line,
        section: match[5] ?? "",
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      current.hunks.push(parsed);
      hunk = parsed;
      oldLine = parsed.oldStart;
      newLine = parsed.newStart;
      continue;
    }

    if (hunk) {
      if (line.startsWith("\\")) {
        hunk.lines.push({
          type: "\\",
          text: line.slice(1),
          raw: line,
          oldLine: null,
          newLine: null,
          index: hunk.lines.length,
        });
        continue;
      }
      const marker = line[0] ?? " ";
      if (marker !== " " && marker !== "+" && marker !== "-") {
        continue;
      }
      const text = line.slice(1);
      const entry: DiffLine = {
        type: marker,
        text,
        raw: line,
        oldLine: marker === "+" ? null : oldLine,
        newLine: marker === "-" ? null : newLine,
        index: hunk.lines.length,
      };
      hunk.lines.push(entry);
      if (marker !== "+") oldLine += 1;
      if (marker !== "-") newLine += 1;
      continue;
    }

    if (!current.header.includes(line)) current.header.push(line);
  }
  finish();

  return files.filter((file) => file.hunks.length > 0 || file.binary || file.raw.length > 0);
}

function parsePath(value: string): string | null {
  let path = value.split("\t")[0].trim();
  if (!path) return null;
  if (path.startsWith('"') && path.endsWith('"')) {
    path = unquoteGitPath(path);
  }
  if (path === "/dev/null") return null;
  if (path.startsWith("a/") || path.startsWith("b/")) {
    path = path.slice(2);
  }
  return path;
}

function unquoteGitPath(quoted: string): string {
  const body = quoted.slice(1, -1);
  return body.replace(/\\(["\\tnr]|[0-7]{1,3})/g, (_, code: string) => {
    if (code === "t") return "\t";
    if (code === "n") return "\n";
    if (code === "r") return "\r";
    if (code === "\\") return "\\";
    if (code === '"') return '"';
    return String.fromCharCode(parseInt(code, 8));
  });
}

/**
 * Genera un parche mínimo aplicable con `git apply --cached`.
 * `selection` contiene los índices de línea (dentro del hunk) que se quieren
 * preparar; `null` significa preparar el bloque completo.
 */
export function buildPatch(
  file: DiffFile,
  hunk: DiffHunk,
  selection: Set<number> | null,
): string {
  const body: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  let changes = 0;

  for (const line of hunk.lines) {
    if (line.type === "\\") {
      body.push(line.raw);
      continue;
    }
    if (line.type === " ") {
      body.push(` ${line.text}`);
      oldCount += 1;
      newCount += 1;
      continue;
    }
    const selected = selection === null || selection.has(line.index);
    if (!selected) continue;
    if (line.type === "-") {
      body.push(`-${line.text}`);
      oldCount += 1;
      changes += 1;
    } else if (line.type === "+") {
      body.push(`+${line.text}`);
      newCount += 1;
      changes += 1;
    }
  }

  if (changes === 0) return "";

  const header = file.header
    .filter((line) => !line.startsWith("\\") && !line.startsWith("Binary files"))
    .join("\n");
  const section = hunk.section ? ` ${hunk.section}` : "";
  const hunkHeader = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@${section}`;
  return `${header}\n${hunkHeader}\n${body.join("\n")}\n`;
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

export function splitHunk(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < hunk.lines.length) {
    const line = hunk.lines[i];
    if (line.type === " " || line.type === "\\") {
      rows.push({ left: line, right: line });
      i += 1;
      continue;
    }
    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (i < hunk.lines.length) {
      const next = hunk.lines[i];
      if (next.type === "-") {
        deletions.push(next);
        i += 1;
      } else if (next.type === "+") {
        additions.push(next);
        i += 1;
      } else {
        break;
      }
    }
    const total = Math.max(deletions.length, additions.length);
    for (let k = 0; k < total; k += 1) {
      rows.push({
        left: deletions[k] ?? null,
        right: additions[k] ?? null,
      });
    }
  }
  return rows;
}

export function diffTitles(file: DiffFile): { oldTitle: string; newTitle: string } {
  return {
    oldTitle: file.oldPath ?? "/dev/null",
    newTitle: file.newPath ?? "/dev/null",
  };
}

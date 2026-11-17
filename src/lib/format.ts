const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});
const dayFormatter = new Intl.DateTimeFormat("es", { dateStyle: "long" });

export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value * 1000);
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && /^\d+$/.test(value)) {
    return new Date(asNumber * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function relativeTime(value: string | number | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const divisions: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let duration = seconds;
  for (const [amount, unit] of divisions) {
    if (Math.abs(duration) < amount) {
      return relative.format(Math.round(duration), unit);
    }
    duration /= amount;
  }
  return relative.format(Math.round(duration), "year");
}

export function fullDate(value: string | number | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : "—";
}

export function dayLabel(value: string | number | null | undefined): string {
  const date = toDate(value);
  return date ? dayFormatter.format(date) : "—";
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 52% 38%)`;
}

export function humanCount(count: number): string {
  if (count === 1) return "1 archivo";
  return `${count} archivos`;
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function fileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function dirName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

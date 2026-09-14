// Czech number and date formatting in one place, so "20,8 %" and "554 668"
// look the same on every screen. Intl does the locale work; this file only
// decides how many decimals a value deserves.

const cache = new Map<number, Intl.NumberFormat>();
function nf(decimals: number): Intl.NumberFormat {
  let f = cache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
    cache.set(decimals, f);
  }
  return f;
}

export const DASH = "—";

/** Decimals follow magnitude unless asked: 554 668, 20,8, 0,42. */
export function num(v: number | null | undefined, decimals?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  const abs = Math.abs(v);
  const d = decimals ?? (abs >= 1000 ? 0 : abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
  return nf(d).format(v).replace("-", "−");
}

export function pct(v: number | null | undefined, decimals = 1): string {
  return v === null || v === undefined ? DASH : `${num(v, decimals)} %`;
}

export function signed(v: number | null | undefined, decimals?: number, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  const s = num(Math.abs(v), decimals);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${s}${suffix}`;
}

export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${num(v / 1e9, 1)} mld.`;
  if (abs >= 1e6) return `${num(v / 1e6, 1)} mil.`;
  if (abs >= 1e4) return `${num(v / 1e3, 1)} tis.`;
  return num(v);
}

export function kc(v: number | null | undefined): string {
  return v === null || v === undefined ? DASH : `${compact(v)} Kč`;
}

export function withUnit(v: number | null | undefined, unit: string, decimals?: number): string {
  if (v === null || v === undefined) return DASH;
  if (unit === "%") return pct(v, decimals ?? 1);
  // A 0/1 flag for one obec; for a larger unit it is the share of residents
  // living in an obec that has the thing.
  if (unit === "ano/ne") return v === 1 ? "ano" : v === 0 ? "ne" : `${num(v * 100, 0)} % obyvatel`;
  return unit ? `${num(v, decimals)} ${unit}` : num(v, decimals);
}

/** Czech plural: 1 sada, 2–4 sady, 5+ sad. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a >= 2 && a <= 4 && Number.isInteger(a)) return few;
  return many;
}

const rtf = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat("cs", { numeric: "auto" }) : null;

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((t - now) / 1000);
  const abs = Math.abs(sec);
  if (!rtf) return date(iso);
  if (abs < 60) return rtf.format(sec, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  if (abs < 86400 * 45) return rtf.format(Math.round(sec / 86400), "day");
  if (abs < 86400 * 400) return rtf.format(Math.round(sec / (86400 * 30)), "month");
  return rtf.format(Math.round(sec / (86400 * 365)), "year");
}

export function date(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Plain, lowercase, unaccented — for client-side filtering. */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

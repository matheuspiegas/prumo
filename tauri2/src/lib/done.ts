/**
 * Aba Concluídas: períodos, agrupamento por dia/semana/mês, pontualidade e contagem por dia.
 * Funções puras sobre datas ISO locais (YYYY-MM-DD), para testar sem o Tauri.
 */
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { fromIso, toIso, type CompletedItem } from "@/lib/api";

export type GroupBy = "day" | "week" | "month";
export type RangeKind = "7d" | "30d" | "month" | "all" | "custom";
/** Período em datas locais inclusivas; null = sem limite. */
export type Period = { from: string | null; to: string | null };
export type { CompletedItem };

/** Data local (YYYY-MM-DD) da conclusão. */
export const doneDate = (c: CompletedItem) => c.completedAt.slice(0, 10);
/** Hora local (HH:MM) da conclusão. */
export const doneTime = (c: CompletedItem) => c.completedAt.slice(11, 16);

const iso = (d: Date) => toIso(d);
const parse = (s: string) => fromIso(s) ?? new Date(NaN);

/** Período do filtro. `custom` usa o intervalo escolhido no calendário. */
export function periodOf(kind: RangeKind, today: string, custom?: Period): Period {
  const t = parse(today);
  switch (kind) {
    case "7d":
      return { from: iso(addDays(t, -6)), to: today };
    case "30d":
      return { from: iso(addDays(t, -29)), to: today };
    case "month":
      return { from: iso(startOfMonth(t)), to: today };
    case "custom":
      return custom ?? { from: null, to: null };
    case "all":
      return { from: null, to: null };
  }
}

/**
 * Período anterior de mesmo tamanho, para comparar. "Este mês" compara com o mês passado até
 * o mesmo dia (1º–17 de out vs. 1º–17 de nov). Sem início definido não há comparação.
 */
export function previousPeriod(kind: RangeKind, p: Period): Period | null {
  if (!p.from || !p.to) return null;
  const from = parse(p.from);
  const to = parse(p.to);
  if (kind === "month") {
    const prevStart = subMonths(from, 1);
    const sameDay = addDays(prevStart, differenceInCalendarDays(to, from));
    const end = sameDay > endOfMonth(prevStart) ? endOfMonth(prevStart) : sameDay;
    return { from: iso(prevStart), to: iso(end) };
  }
  const len = differenceInCalendarDays(to, from) + 1;
  return { from: iso(addDays(from, -len)), to: iso(addDays(from, -1)) };
}

/** Chave do grupo: o dia, a segunda-feira da semana ou o 1º do mês. */
export function groupKey(date: string, by: GroupBy): string {
  const d = parse(date);
  if (by === "week") return iso(startOfWeek(d, { weekStartsOn: 1 }));
  if (by === "month") return iso(startOfMonth(d));
  return date;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Título do grupo: relativo quando ajuda ("Hoje", "Semana passada", "Este mês"). */
export function groupTitle(key: string, by: GroupBy, today: string): { title: string; kicker?: string } {
  const d = parse(key);
  const t = parse(today);
  if (by === "day") {
    const diff = differenceInCalendarDays(t, d);
    const date = format(d, "d MMM", { locale: ptBR });
    const wd = format(d, "EEE", { locale: ptBR });
    if (diff === 0) return { title: date, kicker: `Hoje · ${wd}` };
    if (diff === 1) return { title: date, kicker: `Ontem · ${wd}` };
    return { title: date, kicker: d.getFullYear() === t.getFullYear() ? wd : `${wd} · ${d.getFullYear()}` };
  }
  if (by === "week") {
    const end = addDays(d, 6);
    const range =
      d.getMonth() === end.getMonth()
        ? `${format(d, "d")} – ${format(end, "d MMM", { locale: ptBR })}`
        : `${format(d, "d MMM", { locale: ptBR })} – ${format(end, "d MMM", { locale: ptBR })}`;
    const thisWeek = iso(startOfWeek(t, { weekStartsOn: 1 }));
    const kicker = key === thisWeek ? "Esta semana" : key === iso(addDays(parse(thisWeek), -7)) ? "Semana passada" : "Semana";
    return { title: range, kicker };
  }
  const month = cap(format(d, "MMMM", { locale: ptBR }));
  const thisMonth = iso(startOfMonth(t));
  const kicker =
    key === thisMonth ? "Este mês" : key === iso(subMonths(parse(thisMonth), 1)) ? "Mês passado" : String(d.getFullYear());
  return { title: month, kicker };
}

export type Group = { key: string; title: string; kicker?: string; items: CompletedItem[] };

/** Agrupa (do mais recente para o mais antigo), mantendo a ordem dos itens. */
export function groupItems(items: CompletedItem[], by: GroupBy, today: string): Group[] {
  const map = new Map<string, CompletedItem[]>();
  for (const c of items) {
    const k = groupKey(doneDate(c), by);
    const list = map.get(k);
    if (list) list.push(c);
    else map.set(k, [c]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, list]) => ({ key, ...groupTitle(key, by, today), items: list }));
}

export type Punctuality = { kind: "early" | "ontime" | "late"; days: number; label: string };

/** Conclusão comparada com a data prevista; null quando a tarefa não tinha data. */
export function punctuality(due: string | null, completedOn: string): Punctuality | null {
  if (!due) return null;
  const diff = differenceInCalendarDays(parse(completedOn), parse(due));
  if (Number.isNaN(diff)) return null;
  if (diff === 0) return { kind: "ontime", days: 0, label: "No prazo" };
  const n = Math.abs(diff);
  const dias = n === 1 ? "1 dia" : `${n} dias`;
  return diff < 0 ? { kind: "early", days: n, label: `${dias} antes` } : { kind: "late", days: n, label: `${dias} depois` };
}

export type Bucket = { key: string; from: string; to: string; count: number };

/**
 * Barras do mini gráfico: uma por dia no período (ou por semana, se passar de 62 dias, para
 * as barras não ficarem finas demais). Sem início definido, começa na conclusão mais antiga.
 */
export function buckets(items: CompletedItem[], p: Period, today: string): { by: "day" | "week"; list: Bucket[] } {
  const dates = items.map(doneDate);
  const oldest = dates.reduce<string | null>((m, d) => (m === null || d < m ? d : m), null);
  const from = p.from ?? oldest ?? today;
  const to = p.to ?? today;
  const start = parse(from);
  const end = parse(to);
  const days = differenceInCalendarDays(end, start) + 1;
  if (!(days > 0)) return { by: "day", list: [] };
  const by = days > 62 ? "week" : "day";
  const counts = new Map<string, number>();
  for (const d of dates) {
    const k = by === "week" ? groupKey(d, "week") : d;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const list: Bucket[] = [];
  if (by === "day") {
    for (let i = 0; i < days; i++) {
      const k = iso(addDays(start, i));
      list.push({ key: k, from: k, to: k, count: counts.get(k) ?? 0 });
    }
  } else {
    for (let w = startOfWeek(start, { weekStartsOn: 1 }); w <= end; w = addDays(w, 7)) {
      const k = iso(w);
      // A barra cobre só a parte da semana que está dentro do período.
      const a = w < start ? from : k;
      const b = addDays(w, 6) > end ? to : iso(addDays(w, 6));
      list.push({ key: k, from: a, to: b, count: counts.get(k) ?? 0 });
    }
  }
  return { by, list };
}

/** "1 tarefa" / "3 tarefas". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

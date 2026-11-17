import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { format } from "date-fns";
import { ptBR as dfPtBR } from "date-fns/locale";
import { ptBR } from "react-day-picker/locale";
import type { DateRange } from "react-day-picker";
import { CalendarRange, ListChecks, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { AnimatedCount } from "@/components/animated-count";
import { Collapse } from "@/components/animated-title";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, fromIso, toIso, type CompletedItem, type Task } from "@/lib/api";
import {
  buckets,
  doneDate,
  groupItems,
  periodOf,
  plural,
  previousPeriod,
  punctuality,
  type Bucket,
  type Group,
  type GroupBy,
  type Period,
  type RangeKind,
} from "@/lib/done";
import { DUR_BASE, easeOut, softSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { DoneChart } from "./done-chart";
import { DoneItem } from "./done-item";

/** Largura (px) a partir da qual os grupos viram colunas lado a lado. */
const COLUMNS_MIN_WIDTH = 820;

const RANGES: { value: Exclude<RangeKind, "custom">; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "month", label: "Este mês" },
  { value: "all", label: "Tudo" },
];
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];
const PREV_LABEL: Record<RangeKind, string> = {
  "7d": "nos 7 dias anteriores",
  "30d": "nos 30 dias anteriores",
  month: "no mesmo período do mês passado",
  custom: "no período anterior",
  all: "",
};

/** Preferências de visualização deste computador (conveniência; falha em silêncio). */
const PREFS_KEY = "prumo.done.view";
function loadPrefs(): { range: RangeKind; group: GroupBy } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      range: RANGES.some((r) => r.value === p.range) ? p.range : "30d",
      group: GROUPS.some((g) => g.value === p.group) ? p.group : "day",
    };
  } catch {
    return { range: "30d", group: "day" };
  }
}
function savePrefs(range: RangeKind, group: GroupBy) {
  try {
    // "custom" não é lembrado: o intervalo escolhido só faz sentido na hora.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ range: range === "custom" ? "30d" : range, group }));
  } catch {
    /* armazenamento indisponível: segue sem lembrar */
  }
}

/** Seletor segmentado no estilo do resto do app (tema, agente). */
function Segmented<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-lg border bg-muted/50 p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <motion.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            whileTap={{ scale: 0.95 }}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && <motion.span layoutId={`seg-${id}`} transition={softSpring} className="absolute inset-0 rounded-md bg-primary" />}
            <span className="relative">{o.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

const short = (iso: string) => {
  const d = fromIso(iso);
  return d ? format(d, "d MMM", { locale: dfPtBR }) : iso;
};

/** Largura do elemento, acompanhando redimensionamentos da janela e da barra lateral. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function DoneView({
  today,
  tomorrow,
  refreshKey,
  onOpenTask,
  onChanged,
  pushUndo,
}: {
  today: string;
  tomorrow: string;
  /** Muda a cada refresh do App: recarrega o período. */
  refreshKey: number;
  onOpenTask: (t: Task) => void;
  /** Avisa o App (contadores, outras listas) depois de reabrir uma tarefa. */
  onChanged: () => void;
  pushUndo: (message: string, run: () => Promise<unknown> | void) => void;
}) {
  const [prefs] = useState(loadPrefs);
  const [range, setRange] = useState<RangeKind>(prefs.range);
  const [group, setGroup] = useState<GroupBy>(prefs.group);
  const [custom, setCustom] = useState<Period | null>(null);
  const [picking, setPicking] = useState<DateRange | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState<CompletedItem[] | null>(null);
  const [prevCount, setPrevCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Bucket | null>(null);
  const [rootRef, width] = useWidth<HTMLDivElement>();

  useEffect(() => savePrefs(range, group), [range, group]);

  const period = useMemo(() => (today ? periodOf(range, today, custom ?? undefined) : null), [range, today, custom]);
  const prev = useMemo(() => (period ? previousPeriod(range, period) : null), [range, period]);

  useEffect(() => setSelected(null), [period?.from, period?.to]);

  useEffect(() => {
    if (!period) return;
    let stale = false;
    api
      .listCompleted(period.from, period.to)
      .then((list) => !stale && setItems(list))
      .catch((e) => toast.error(String(e)));
    if (prev) {
      api
        .countCompleted(prev.from, prev.to)
        .then((n) => !stale && setPrevCount(n))
        .catch(() => !stale && setPrevCount(null));
    } else setPrevCount(null);
    return () => {
      stale = true;
    };
  }, [period, prev, refreshKey]);

  const chart = useMemo(() => (items && period ? buckets(items, period, today) : null), [items, period, today]);
  const shown = useMemo(
    () => (items && selected ? items.filter((c) => doneDate(c) >= selected.from && doneDate(c) <= selected.to) : (items ?? [])),
    [items, selected],
  );
  const groups = useMemo(() => groupItems(shown, group, today), [shown, group, today]);

  const total = items?.length ?? 0;
  const dated = (items ?? []).map((c) => punctuality(c.task.due, doneDate(c))).filter((p) => p !== null);
  const onTime = dated.filter((p) => p.kind !== "late").length;
  const delta = prevCount === null ? null : total - prevCount;
  const columns = width >= COLUMNS_MIN_WIDTH && groups.length > 1;

  const reopen = (c: CompletedItem) => {
    setItems((list) => list?.filter((x) => x.task.id !== c.task.id) ?? list);
    pushUndo("Tarefa reaberta", () => api.setDone(c.task.id, true));
    api
      .setDone(c.task.id, false)
      .catch((e) => toast.error(String(e)))
      .finally(onChanged);
  };

  const customLabel = range === "custom" && custom?.from && custom.to ? `${short(custom.from)} – ${short(custom.to)}` : "Período";

  const renderItems = (g: Group, variant: "row" | "card") => (
    <ul className={variant === "row" ? "flex flex-col gap-0.5" : undefined}>
      <AnimatePresence initial={false}>
        {g.items.map((c) => (
          <DoneItem
            key={c.task.id}
            item={c}
            variant={variant}
            today={today}
            tomorrow={tomorrow}
            onOpen={() => onOpenTask(c.task)}
            onReopen={() => reopen(c)}
          />
        ))}
      </AnimatePresence>
    </ul>
  );

  return (
    <div ref={rootRef} className="flex h-full w-full flex-col">
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col gap-4 pt-8",
          columns ? "px-6" : "mx-auto max-w-2xl px-8",
        )}
      >
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Concluídas</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                <span>
                  <AnimatedCount value={total} /> {total === 1 ? "concluída" : "concluídas"}
                </span>
                {delta !== null && (
                  <span className="inline-flex items-center gap-1">
                    {delta > 0 ? <TrendingUp className="size-3.5" aria-hidden /> : delta < 0 ? <TrendingDown className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
                    {delta === 0 ? `igual ${PREV_LABEL[range]}` : `${Math.abs(delta)} a ${delta > 0 ? "mais" : "menos"} que ${PREV_LABEL[range]}`}
                  </span>
                )}
                {dated.length > 0 && (
                  <span>
                    · {onTime} de {dated.length} com data no prazo
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                id="range"
                label="Período"
                value={range === "custom" ? null : range}
                options={RANGES}
                onChange={(v) => {
                  setRange(v);
                  setCustom(null);
                }}
              />
              <Popover
                open={pickerOpen}
                onOpenChange={(o) => {
                  setPickerOpen(o);
                  if (o) setPicking(custom?.from && custom.to ? { from: fromIso(custom.from), to: fromIso(custom.to) } : undefined);
                }}
              >
                <PopoverTrigger
                  render={
                    <Button size="sm" variant={range === "custom" ? "default" : "outline"} className="h-8">
                      <CalendarRange data-icon="inline-start" />
                      {customLabel}
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    locale={ptBR}
                    selected={picking}
                    defaultMonth={picking?.from ?? fromIso(today)}
                    disabled={{ after: fromIso(today) ?? new Date() }}
                    onSelect={(r) => {
                      setPicking(r);
                      if (r?.from && r.to && r.from.getTime() !== r.to.getTime()) {
                        setCustom({ from: toIso(r.from), to: toIso(r.to) });
                        setRange("custom");
                        setPickerOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
              <Segmented id="group" label="Agrupar por" value={group} options={GROUPS} onChange={setGroup} />
            </div>
          </div>
        </header>

        {chart && chart.list.length > 1 && total > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DUR_BASE, ease: easeOut } }}
            className="rounded-xl border bg-muted/30 px-4 pt-3 pb-2"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-medium text-muted-foreground">
                Concluídas por {chart.by === "day" ? "dia" : "semana"}
              </h2>
              <Collapse show={!!selected}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setSelected(null)}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  {selected && (selected.from === selected.to ? short(selected.from) : `${short(selected.from)} – ${short(selected.to)}`)}
                  {" · "}
                  {plural(shown.length, "tarefa", "tarefas")} <X className="size-3" />
                </motion.button>
              </Collapse>
            </div>
            <DoneChart by={chart.by} list={chart.list} selected={selected?.key ?? null} onSelect={setSelected} />
          </motion.section>
        )}

        {items !== null && shown.length === 0 && (
          <EmptyState
            icon={ListChecks}
            title={total === 0 ? "Nada concluído neste período." : "Nada concluído nesse dia."}
            hint={total === 0 ? "Experimente um período maior ou “Tudo”." : undefined}
          />
        )}

        {shown.length > 0 &&
          (columns ? (
            <div className="-mx-6 flex min-h-0 flex-1 snap-x snap-proximity scroll-pl-6 gap-3 overflow-x-auto px-6 pb-4">
              {groups.map((g) => (
                <section
                  key={g.key}
                  aria-label={`${g.kicker ?? ""} ${g.title}`.trim()}
                  className="flex h-full w-[280px] shrink-0 snap-start flex-col rounded-xl border bg-muted/30"
                >
                  <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                    <div className="min-w-0">
                      {g.kicker && (
                        <div className="text-[11px] leading-none font-medium tracking-wide text-muted-foreground uppercase">{g.kicker}</div>
                      )}
                      <h2 className={cn("truncate text-sm font-semibold", g.kicker && "mt-1")}>{g.title}</h2>
                    </div>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      <AnimatedCount value={g.items.length} />
                    </span>
                  </header>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pt-1 pb-2 [scrollbar-color:color-mix(in_oklab,var(--foreground)_22%,transparent)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]">
                    {renderItems(g, "card")}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="-mx-3 min-h-0 flex-1 overflow-y-auto pb-8">
              {groups.map((g) => (
                <section key={g.key} aria-label={`${g.kicker ?? ""} ${g.title}`.trim()} className="mb-3">
                  <header className="sticky top-0 z-10 flex items-baseline gap-2 bg-background/95 px-3 py-1.5 backdrop-blur">
                    {g.kicker && <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.kicker}</span>}
                    <h2 className="text-sm font-semibold">{g.title}</h2>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{plural(g.items.length, "tarefa", "tarefas")}</span>
                  </header>
                  {renderItems(g, "row")}
                </section>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

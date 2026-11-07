import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { motion } from "motion/react";
import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/animated-title";
import { api, fromIso, toIso, type Task, type WeekData } from "@/lib/api";
import { WeekColumn, type ColumnProps } from "./week-column";
import { LiftedCard } from "./week-card";

const DAYS = 7;
const SHIFT_MS = 150; // janela após soltar em que o clique sintético é ignorado

type ColDef = { id: string; date: string | null; kind: "overdue" | "day" | "undated"; pending: Task[]; done: Task[] };
type Ids = Record<string, number[]>;
type Origin = { colId: string; date: string | null; index: number };

const dayId = (date: string) => `d:${date}`;

/** Pendentes (sem filtro) da coluna, na ordem do servidor. */
function fullPending(d: WeekData, colId: string): Task[] {
  if (colId === "overdue") return d.overdue;
  if (colId === "undated") return d.undated;
  return d.days.find((x) => dayId(x.date) === colId)?.tasks.filter((t) => !t.done) ?? [];
}

/** Move a tarefa para a coluna/posição (entre as pendentes) no estado local, antes de o servidor responder. */
function applyMove(d: WeekData, id: number, date: string | null, index: number): WeekData {
  const all = [...d.overdue, ...d.undated, ...d.days.flatMap((x) => x.tasks)];
  const task = all.find((t) => t.id === id);
  if (!task) return d;
  const moved = { ...task, due: date };
  const without = (l: Task[]) => l.filter((t) => t.id !== id);
  const put = (l: Task[]) => [...l.slice(0, index), moved, ...l.slice(index)];
  return {
    overdue: without(d.overdue),
    undated: date === null ? put(without(d.undated)) : without(d.undated),
    days: d.days.map((x) => {
      const rest = without(x.tasks);
      if (x.date !== date) return { ...x, tasks: rest };
      const pend = rest.filter((t) => !t.done);
      return { ...x, tasks: [...put(pend), ...rest.filter((t) => t.done)] };
    }),
  };
}

/** Marca/desmarca concluída no estado local (concluídas vão para o fim do dia). */
function applyDone(d: WeekData, id: number, done: boolean): WeekData {
  return {
    overdue: done ? d.overdue.filter((t) => t.id !== id) : d.overdue,
    undated: done ? d.undated.filter((t) => t.id !== id) : d.undated,
    days: d.days.map((x) => {
      const t = x.tasks.find((y) => y.id === id);
      if (!t) return x;
      const rest = x.tasks.filter((y) => y.id !== id);
      const upd = { ...t, done };
      const pend = rest.filter((y) => !y.done);
      const dn = rest.filter((y) => y.done);
      return { ...x, tasks: done ? [...pend, ...dn, upd] : [...pend, upd, ...dn] };
    }),
  };
}

/** Prefere o cartão sob o ponteiro; senão a coluna. Teclado (sem ponteiro) usa cantos. */
const collision: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCorners(args);
  const hits = pointerWithin(args);
  const items = hits.filter((h) => !String(h.id).startsWith("col:"));
  return items.length ? items : hits;
};

function rangeLabel(a: Date, b: Date) {
  return a.getMonth() === b.getMonth()
    ? `${format(a, "d")} – ${format(b, "d MMM", { locale: ptBR })}`
    : `${format(a, "d MMM", { locale: ptBR })} – ${format(b, "d MMM", { locale: ptBR })}`;
}

export function WeekView({
  today,
  tomorrow,
  refreshKey,
  activeTag,
  onClearTag,
  onOpenTask,
  pushUndo,
}: {
  today: string;
  tomorrow: string;
  /** Muda a cada refresh do App (tasks-changed, foco, diálogo salvo): recarrega a semana. */
  refreshKey: number;
  activeTag: string | null;
  onClearTag: () => void;
  onOpenTask: (t: Task) => void;
  pushUndo: (message: string, run: () => Promise<unknown> | void) => void;
}) {
  const [from, setFrom] = useState<string | null>(null); // null = hoje
  const start = from ?? today;
  const [data, setData] = useState<WeekData | null>(null);
  const [live, setLive] = useState<Ids | null>(null); // ordem durante o arrasto
  const [activeId, setActiveId] = useState<number | null>(null);

  const liveRef = useRef<Ids | null>(null);
  liveRef.current = live;
  const dataRef = useRef<WeekData | null>(null);
  dataRef.current = data;
  const draggingRef = useRef(false);
  const dirtyRef = useRef(false);
  const reqRef = useRef(0);
  const originRef = useRef<Origin | null>(null);
  const lastDrop = useRef(0);

  const load = useCallback(async () => {
    if (!start) return;
    if (draggingRef.current) {
      dirtyRef.current = true; // não sobrescreve a ordem durante o arrasto
      return;
    }
    const n = ++reqRef.current;
    try {
      const d = await api.week(start, DAYS);
      if (n !== reqRef.current) return;
      if (draggingRef.current) {
        dirtyRef.current = true;
        return;
      }
      setData(d);
    } catch (e) {
      toast.error(String(e));
    }
  }, [start]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const flush = () => {
    if (dirtyRef.current) {
      dirtyRef.current = false;
      void load();
    }
  };

  // Colunas visíveis (filtro por tag aplicado no cliente).
  const cols = useMemo<ColDef[]>(() => {
    if (!data) return [];
    const tag = activeTag?.toLowerCase();
    const keep = (t: Task) => !tag || t.tags.some((x) => x.toLowerCase() === tag);
    return [
      { id: "overdue", date: null, kind: "overdue", pending: data.overdue.filter(keep), done: [] },
      ...data.days.map((d) => ({
        id: dayId(d.date),
        date: d.date,
        kind: "day" as const,
        pending: d.tasks.filter((t) => !t.done && keep(t)),
        done: d.tasks.filter((t) => t.done && keep(t)),
      })),
      { id: "undated", date: null, kind: "undated", pending: data.undated.filter(keep), done: [] },
    ];
  }, [data, activeTag]);

  const baseIds = useMemo<Ids>(() => Object.fromEntries(cols.map((c) => [c.id, c.pending.map((t) => t.id)])), [cols]);
  const byId = useMemo(() => new Map(cols.flatMap((c) => [...c.pending, ...c.done]).map((t) => [t.id, t])), [cols]);

  const colTitle = useCallback(
    (id: string) => {
      if (id === "overdue") return "Atrasadas";
      if (id === "undated") return "Sem data";
      const d = fromIso(id.slice(2));
      return d ? format(d, "EEEE, d MMM", { locale: ptBR }) : id;
    },
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  const colOf = (ids: Ids, id: number | string) => Object.keys(ids).find((k) => ids[k].includes(Number(id)));
  const overCol = (over: DragOverEvent["over"]): string | undefined => {
    if (!over) return undefined;
    const d = over.data.current as { type?: string; colId?: string; sortable?: { containerId: string } } | undefined;
    return d?.type === "column" ? d.colId : d?.sortable?.containerId;
  };

  const onDragStart = (e: DragStartEvent) => {
    const d = dataRef.current;
    const id = Number(e.active.id);
    const from = d && colOf(baseIds, id);
    if (!d || !from) return;
    draggingRef.current = true;
    const def = cols.find((c) => c.id === from);
    originRef.current = { colId: from, date: def?.date ?? null, index: fullPending(d, from).findIndex((t) => t.id === id) };
    setActiveId(id);
    setLive(baseIds);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const to = overCol(over);
    if (!over || !to || to === "overdue") return; // Atrasadas não aceita soltar
    setLive((prev) => {
      if (!prev) return prev;
      const id = Number(active.id);
      const fromCol = colOf(prev, id);
      if (!fromCol || fromCol === to) return prev;
      const dest = prev[to] ?? [];
      const overIdx = dest.indexOf(Number(over.id));
      const translated = active.rect.current.translated;
      const below = !!translated && translated.top > over.rect.top + over.rect.height / 2;
      const idx = overIdx < 0 ? dest.length : overIdx + (below ? 1 : 0);
      return {
        ...prev,
        [fromCol]: prev[fromCol].filter((x) => x !== id),
        [to]: [...dest.slice(0, idx), id, ...dest.slice(idx)],
      };
    });
  };

  const finish = () => {
    draggingRef.current = false;
    lastDrop.current = Date.now();
    originRef.current = null;
    setActiveId(null);
    setLive(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const ids = liveRef.current;
    const origin = originRef.current;
    const d = dataRef.current;
    const id = Number(active.id);
    const toCol = ids && colOf(ids, id);
    const dest = cols.find((c) => c.id === toCol);
    if (!ids || !origin || !d || !over || !toCol || !dest || toCol === "overdue") {
      finish();
      flush();
      return;
    }
    // Reordenação dentro da coluna (o cruzamento entre colunas já foi aplicado em onDragOver).
    let list = ids[toCol];
    const overIdx = list.indexOf(Number(over.id));
    const cur = list.indexOf(id);
    if (overCol(over) === toCol && overIdx >= 0 && cur >= 0 && overIdx !== cur) list = arrayMove(list, cur, overIdx);

    // Índice entre TODAS as pendentes do destino (sem a própria tarefa), mesmo com filtro de tag.
    const full = fullPending(d, toCol).filter((t) => t.id !== id);
    const next = list[list.indexOf(id) + 1];
    const found = next === undefined ? -1 : full.findIndex((t) => t.id === next);
    const index = found < 0 ? full.length : found;
    const changedCol = toCol !== origin.colId;

    if (!changedCol && index === origin.index) {
      finish();
      flush();
      return;
    }

    setData(applyMove(d, id, dest.date, index));
    finish();
    api
      .moveTask(id, dest.date, index)
      .catch((e) => toast.error(String(e)))
      .finally(() => {
        dirtyRef.current = false;
        void load();
      });
    if (changedCol) {
      const label =
        dest.kind === "undated"
          ? "Sem data"
          : dest.date === today
            ? "hoje"
            : dest.date === tomorrow
              ? "amanhã"
              : format(fromIso(dest.date!) ?? new Date(), "EEEE", { locale: ptBR });
      pushUndo(dest.kind === "undated" ? "Movida para Sem data" : `Movida para ${label}`, () =>
        api.moveTask(id, origin.date, origin.index),
      );
    }
  };

  const onDragCancel = () => {
    finish();
    flush();
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tarefa ${byId.get(Number(active.id))?.title ?? ""} levantada.`,
    onDragOver: ({ over }) => {
      const c = overCol(over);
      return c ? `Sobre ${colTitle(c)}.` : undefined;
    },
    onDragEnd: ({ over }) => {
      const c = overCol(over);
      return c ? `Tarefa solta em ${colTitle(c)}.` : "Tarefa devolvida ao lugar original.";
    },
    onDragCancel: () => "Movimento cancelado.",
  };

  const toggle = (t: Task, done: boolean) => {
    if (done) pushUndo("Tarefa concluída", () => api.setDone(t.id, false));
    setData((d) => (d ? applyDone(d, t.id, done) : d));
    api
      .setDone(t.id, done)
      .catch((e) => toast.error(String(e)))
      .finally(() => void load());
  };

  const add = async (title: string, date: string | null) => {
    try {
      const id = await api.add(title, "", date);
      // Com filtro de tag ativo, a tarefa nasce com a tag (senão sumiria da coluna).
      if (activeTag) await api.setTags(id, [activeTag]);
    } catch (e) {
      toast.error(String(e));
    }
    void load();
  };

  const startDate = fromIso(start);
  const endDate = startDate ? addDays(startDate, DAYS - 1) : null;
  const shift = (n: number) => startDate && setFrom(toIso(addDays(startDate, n)));
  const activeTask = activeId !== null ? byId.get(activeId) : undefined;
  const ids = live ?? baseIds;
  const activeCol = activeId !== null && live ? colOf(live, activeId) : undefined;

  const colProps = (c: ColDef): ColumnProps => {
    const d = c.date ? fromIso(c.date) : undefined;
    const rel = c.date === today ? "Hoje" : c.date === tomorrow ? "Amanhã" : undefined;
    const pending = (ids[c.id] ?? []).map((id) => byId.get(id)).filter((t): t is Task => !!t);
    return {
      id: c.id,
      title: c.kind === "overdue" ? "Atrasadas" : c.kind === "undated" ? "Sem data" : d ? format(d, "d MMM", { locale: ptBR }) : c.id,
      kicker: c.kind === "day" && d ? (rel ? `${rel} · ${format(d, "EEE", { locale: ptBR })}` : format(d, "EEE", { locale: ptBR })) : undefined,
      isToday: c.date === today,
      date: c.date,
      pending,
      done: c.done,
      today,
      tomorrow,
      droppable: c.kind !== "overdue",
      canAdd: c.kind !== "overdue",
      dragging: activeId !== null,
      target: activeCol === c.id,
      canOpen: () => Date.now() - lastDrop.current > SHIFT_MS,
      onOpen: onOpenTask,
      onToggle: toggle,
      onAdd: add,
    };
  };

  return (
    <div className="flex h-full flex-col gap-4 px-6 pt-8">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Semana</h1>
          <Collapse show={!!activeTag}>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={onClearTag}
              className="mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              Filtrando por #{activeTag} <X className="size-3" />
            </motion.button>
          </Collapse>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="icon-sm" variant="outline" onClick={() => shift(-DAYS)} aria-label="Semana anterior">
            <ChevronLeft />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFrom(null)} disabled={from === null || from === today}>
            Hoje
          </Button>
          <Button size="icon-sm" variant="outline" onClick={() => shift(DAYS)} aria-label="Próxima semana">
            <ChevronRight />
          </Button>
          <span className="ml-2 min-w-24 text-sm text-muted-foreground tabular-nums">
            {startDate && endDate ? rangeLabel(startDate, endDate) : ""}
          </span>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={{ threshold: { x: 0.12, y: 0.15 }, acceleration: 12 }}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Para mover a tarefa, pressione Espaço, use as setas para escolher o dia ou a posição e pressione Espaço ou Enter para soltar. Esc cancela.",
          },
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div
          className={`-mx-6 flex min-h-0 flex-1 scroll-pl-6 gap-3 overflow-x-auto px-6 pb-4 ${
            activeId !== null ? "snap-none" : "snap-x snap-mandatory"
          }`}
        >
          {cols.map((c) => (
            <WeekColumn key={c.id} {...colProps(c)} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
          {activeTask ? <LiftedCard task={activeTask} today={today} tomorrow={tomorrow} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

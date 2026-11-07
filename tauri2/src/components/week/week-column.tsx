import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { AnimatedCount } from "@/components/animated-count";
import { Input } from "@/components/ui/input";
import type { Task } from "@/lib/api";
import { cn } from "@/lib/utils";
import { WeekCard, WeekDoneCard } from "./week-card";

export type ColumnProps = {
  id: string;
  title: string;
  /** Linha pequena acima do título (dia da semana). */
  kicker?: string;
  isToday?: boolean;
  /** Data da coluna (YYYY-MM-DD) ou null (Atrasadas / Sem data). */
  date: string | null;
  pending: Task[];
  done: Task[];
  today: string;
  tomorrow: string;
  droppable: boolean;
  canAdd: boolean;
  /** Há um arrasto em curso. */
  dragging: boolean;
  /** Coluna que receberia o cartão agora. */
  target: boolean;
  canOpen: () => boolean;
  onOpen: (t: Task) => void;
  onToggle: (t: Task, done: boolean) => void;
  onAdd: (title: string, date: string | null) => Promise<void>;
};

export function WeekColumn(p: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${p.id}`,
    data: { type: "column", colId: p.id },
    disabled: !p.droppable,
  });
  const [adding, setAdding] = useState(false);
  const highlight = p.droppable && p.dragging && (p.target || isOver);
  const empty = p.pending.length === 0 && p.done.length === 0;

  return (
    <section
      ref={setNodeRef}
      aria-label={p.title}
      data-week-col={p.id}
      className={cn(
        "flex h-full w-[260px] shrink-0 snap-start flex-col rounded-xl border bg-muted/30 transition-[background-color,box-shadow,border-color] duration-150",
        p.isToday && "border-primary/40",
        highlight && "border-primary/60 bg-primary/5 ring-2 ring-primary/30",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            {p.kicker && (
              <div
                className={cn(
                  "text-[11px] leading-none font-medium tracking-wide text-muted-foreground uppercase",
                  p.isToday && "text-primary",
                )}
              >
                {p.kicker}
              </div>
            )}
            <h2 className={cn("truncate text-sm font-semibold", p.kicker && "mt-1")}>{p.title}</h2>
          </div>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            <AnimatedCount value={p.pending.length} />
          </span>
        </div>
        {p.canAdd && (
          <button
            type="button"
            aria-label={`Adicionar tarefa em ${p.title}`}
            title="Adicionar tarefa"
            onClick={() => setAdding(true)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1">
        <SortableContext id={p.id} items={p.pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <AnimatePresence initial={false}>
            {p.pending.map((t) => (
              <WeekCard
                key={t.id}
                task={t}
                colId={p.id}
                droppable={p.droppable}
                showDate={p.id === "overdue"}
                today={p.today}
                tomorrow={p.tomorrow}
                presence={!p.dragging}
                canOpen={p.canOpen}
                onOpen={() => p.onOpen(t)}
                onToggle={(d) => p.onToggle(t, d)}
              />
            ))}
          </AnimatePresence>
        </SortableContext>
        <AnimatePresence initial={false}>
          {p.done.map((t) => (
            <WeekDoneCard
              key={t.id}
              task={t}
              today={p.today}
              tomorrow={p.tomorrow}
              presence={!p.dragging}
              canOpen={p.canOpen}
              onOpen={() => p.onOpen(t)}
              onToggle={(d) => p.onToggle(t, d)}
            />
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {empty && (
            <motion.p
              key="vazio"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="px-1 py-6 text-center text-xs text-muted-foreground/70"
            >
              {p.dragging && p.droppable ? "Solte aqui" : "Nada por aqui"}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {p.canAdd && <AddInline open={adding} onClose={() => setAdding(false)} onAdd={(t) => p.onAdd(t, p.date)} />}
    </section>
  );
}

/** Criação inline no pé da coluna: Enter cria e mantém aberto; Esc ou blur vazio fecha. */
function AddInline({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await onAdd(t);
  };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="add"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18 }}
          className="overflow-hidden"
        >
          <div className="p-2">
            <Input
              ref={ref}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") {
                  setTitle("");
                  onClose();
                }
              }}
              onBlur={() => !title.trim() && onClose()}
              placeholder="Nova tarefa…"
              className="h-8 text-sm"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

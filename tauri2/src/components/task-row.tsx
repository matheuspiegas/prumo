import { Check, Repeat, Sparkles, Trash2, X } from "lucide-react";
import { recurrenceLabel } from "@/components/recurrence-select";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { useRef, useState, type Ref } from "react";
import { TagChip } from "@/components/tag-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PriorityDot } from "@/components/priority-select";
import { SubtaskProgress } from "@/components/subtasks-list";
import { Highlight } from "@/components/highlight";
import { dueLabel, type Task } from "@/lib/api";
import { bouncy, rowVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Indicadores que surgem/somem com um "pop" discreto (objetos explícitos: não herdam as variants da linha). */
const pop = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1, transition: bouncy },
  exit: { opacity: 0, scale: 0.6, transition: { duration: 0.12 } },
};

export function TaskRow({
  task,
  done,
  today,
  tomorrow,
  inbox,
  reorderable,
  delay,
  ref,
  onOpen,
  onToggle,
  onDelete,
  onApprove,
  onDragStart,
  onDragEnd,
  extra,
  selected,
  highlight,
  onTagClick,
}: {
  /** Clique numa tag da linha (filtra por ela). */
  onTagClick?: (name: string) => void;
  /** Ações extras (ex.: "Reagendar para hoje") antes do botão de excluir. */
  extra?: React.ReactNode;
  task: Task;
  /** Estado de conclusão exibido (pode ser otimista, diferente de task.done). */
  done: boolean;
  today: string;
  tomorrow: string;
  inbox: boolean;
  /** Se true, a linha inteira é um Reorder.Item arrastável. */
  reorderable: boolean;
  /** Atraso (s) da entrada em cascata. */
  delay: number;
  ref?: Ref<HTMLLIElement>;
  onOpen: () => void;
  onToggle: (done: boolean) => void;
  onDelete: () => void;
  onApprove: (el: HTMLElement | null) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Destaque de teclado (atalhos). */
  selected?: boolean;
  /** Termo da busca a destacar no título. */
  highlight?: string;
}) {
  const justDragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const label = dueLabel(task.due, today, tomorrow);
  const overdue = !!task.due && !done && task.due < today;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const className = cn(
    "group relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 transition-[background-color,box-shadow] duration-150 hover:bg-accent",
    dragging && "z-10 bg-background",
    selected && "bg-accent ring-2 ring-ring/50",
  );
  const common = {
    ref,
    "data-task-id": task.id,
    "data-selected": selected ? "" : undefined,
    // Soltar um arrasto não deve abrir a tarefa.
    onClick: () => {
      if (!justDragged.current) onOpen();
    },
    className,
    variants: rowVariants,
    exit: "exit",
    custom: delay,
  };

  const content = (
    <>
      {!inbox && (
        <motion.span onClick={stop} className="flex" whileTap={{ scale: 0.85 }} transition={bouncy}>
          <Checkbox checked={done} onCheckedChange={(c) => onToggle(c === true)} aria-label="Concluir" />
        </motion.span>
      )}
      <span className="min-w-0 flex-1 text-sm">
        <motion.span
          className={cn("relative inline-block max-w-full truncate align-bottom", done && "text-muted-foreground")}
          animate={{ opacity: done ? 0.55 : 1 }}
          transition={{ duration: 0.3 }}
        >
          {highlight ? <Highlight text={task.title} query={highlight} /> : task.title}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-0 left-0 h-px origin-left bg-current"
            initial={false}
            animate={{ scaleX: done ? 1 : 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />
        </motion.span>
      </span>
      <AnimatePresence initial={false}>
        {task.priority > 0 && (
          <motion.span key="prio" className="flex" {...pop}>
            <PriorityDot priority={task.priority} />
          </motion.span>
        )}
        {task.subtasksTotal > 0 && (
          <motion.span key="sub" className="flex" {...pop}>
            <SubtaskProgress done={task.subtasksDone} total={task.subtasksTotal} />
          </motion.span>
        )}
        {task.source !== "manual" && (
          <motion.span key="src" className="flex" {...pop}>
            <Badge variant="secondary" className="gap-1 capitalize">
              <Sparkles className="size-3" />
              {task.source}
            </Badge>
          </motion.span>
        )}
        {task.recurrence && (
          <motion.span key="rec" className="flex" {...pop}>
            <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label={recurrenceLabel(task.recurrence)}>
              <title>{recurrenceLabel(task.recurrence)}</title>
            </Repeat>
          </motion.span>
        )}
      </AnimatePresence>
      {task.tags?.length > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          {task.tags.slice(0, 3).map((t) => (
            <TagChip key={t} name={t} onClick={onTagClick ? () => onTagClick(t) : undefined} />
          ))}
          {task.tags.length > 3 && <span className="text-xs text-muted-foreground">+{task.tags.length - 3}</span>}
        </span>
      )}
      {label && (
        <span className={cn("text-xs text-muted-foreground transition-colors duration-300", overdue && "font-medium text-destructive")}>
          {label}
        </span>
      )}
      <AnimatePresence initial={false}>
        {task.dueTime && (
          <motion.span
            key="time"
            {...pop}
            className={cn(
              "text-xs tabular-nums text-muted-foreground transition-colors duration-300",
              overdue && "text-destructive",
            )}
          >
            {task.dueTime}
          </motion.span>
        )}
      </AnimatePresence>
      <span className="flex items-center gap-1" onClick={stop}>
        {extra}
        {inbox ? (
          <>
            <motion.span className="flex" whileTap={{ scale: 0.95 }} transition={bouncy}>
              <Button size="sm" variant="outline" onClick={(e) => onApprove(e.currentTarget.closest("li"))}>
                <Check data-icon="inline-start" /> Aprovar
              </Button>
            </motion.span>
            <motion.span className="flex" whileTap={{ scale: 0.9 }} transition={bouncy}>
              <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Descartar">
                <X />
              </Button>
            </motion.span>
          </>
        ) : (
          <motion.span className="flex" whileTap={{ scale: 0.9 }} transition={bouncy}>
            <Button
              size="icon-sm"
              variant="ghost"
              className="translate-x-1 opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 focus-visible:translate-x-0 focus-visible:opacity-100"
              onClick={onDelete}
              aria-label="Excluir"
            >
              <Trash2 />
            </Button>
          </motion.span>
        )}
      </span>
    </>
  );

  if (reorderable) {
    return (
      <Reorder.Item
        {...common}
        value={task}
        whileDrag={{ scale: 1.02, boxShadow: "0 10px 28px rgba(0,0,0,0.18)" }}
        onDragStart={() => {
          justDragged.current = true;
          setDragging(true);
          onDragStart?.();
        }}
        onDragEnd={() => {
          setDragging(false);
          // O click sintético vem logo após o pointerup: libera só depois dele.
          setTimeout(() => (justDragged.current = false), 0);
          onDragEnd?.();
        }}
      >
        {content}
      </Reorder.Item>
    );
  }
  return (
    <motion.li {...common} layout="position">
      {content}
    </motion.li>
  );
}

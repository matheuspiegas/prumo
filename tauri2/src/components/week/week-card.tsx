import { forwardRef, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "motion/react";
import { Repeat } from "lucide-react";
import { recurrenceLabel } from "@/components/recurrence-select";
import { PriorityDot } from "@/components/priority-select";
import { SubtaskProgress } from "@/components/subtasks-list";
import { TagChip } from "@/components/tag-chip";
import { Checkbox } from "@/components/ui/checkbox";
import { dueLabel, type Task } from "@/lib/api";
import { DUR_BASE, easeOut } from "@/lib/motion";
import { cn } from "@/lib/utils";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Visual do cartão (sem lógica de arrastar): usado na coluna, nas concluídas e no DragOverlay. */
export const CardBody = forwardRef<
  HTMLDivElement,
  {
    task: Task;
    done?: boolean;
    /** Mostra a data (coluna Atrasadas). */
    showDate?: boolean;
    today: string;
    tomorrow: string;
    /** Cartão em arrasto: fica como "vaga" translúcida na coluna. */
    ghost?: boolean;
    onToggle?: (done: boolean) => void;
  } & Omit<React.HTMLAttributes<HTMLDivElement>, "onToggle">
>(function CardBody({ task, done = false, showDate, today, tomorrow, ghost, onToggle, className, ...rest }, ref) {
  const label = showDate ? dueLabel(task.due, today, tomorrow) : null;
  const hasMeta =
    task.priority > 0 || !!task.dueTime || !!task.recurrence || task.subtasksTotal > 0 || !!label || task.tags.length > 0;
  return (
    <div
      ref={ref}
      {...rest}
      className={cn(
        "flex cursor-pointer select-none flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-sm shadow-xs transition-[background-color,opacity,box-shadow] duration-150 hover:bg-accent/50",
        done && "opacity-55",
        ghost && "opacity-30",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {/* O checkbox não inicia o arrasto nem abre a tarefa. */}
        <span className="flex pt-0.5" onPointerDown={stop} onKeyDown={stop} onClick={stop}>
          <Checkbox checked={done} onCheckedChange={(c) => onToggle?.(c === true)} aria-label="Concluir" />
        </span>
        <span className={cn("min-w-0 flex-1 break-words leading-snug", done && "text-muted-foreground line-through")}>
          {task.title}
        </span>
      </div>
      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-xs text-muted-foreground">
          {label && <span className="font-medium text-destructive">{label}</span>}
          {task.dueTime && <span className="tabular-nums">{task.dueTime}</span>}
          <PriorityDot priority={task.priority} />
          {task.recurrence && (
            <Repeat className="size-3.5 shrink-0" aria-label={recurrenceLabel(task.recurrence)}>
              <title>{recurrenceLabel(task.recurrence)}</title>
            </Repeat>
          )}
          <SubtaskProgress done={task.subtasksDone} total={task.subtasksTotal} />
          {task.tags.slice(0, 2).map((t) => (
            <TagChip key={t} name={t} />
          ))}
          {task.tags.length > 2 && <span>+{task.tags.length - 2}</span>}
        </div>
      )}
    </div>
  );
});

/**
 * Entrada/saída do cartão (altura + fade). Fica DENTRO do nó ordenável: o transform do dnd-kit
 * vai no nó externo e o motion só mexe em altura/opacidade (sem `layout`, que conflitaria).
 * Durante o arraste `presence` é false: sem animação de entrada/saída.
 */
function Pop({ presence, children }: { presence: boolean; children: ReactNode }) {
  return (
    <motion.div
      initial={presence ? { opacity: 0, height: 0, overflow: "hidden" } : false}
      animate={{ opacity: 1, height: "auto", transitionEnd: { overflow: "visible" } }}
      exit={presence ? { opacity: 0, height: 0, overflow: "hidden", transition: { duration: 0.18, ease: easeOut } } : undefined}
      transition={{ duration: DUR_BASE, ease: easeOut }}
    >
      <div className="pb-2">{children}</div>
    </motion.div>
  );
}

type Common = {
  task: Task;
  today: string;
  tomorrow: string;
  presence: boolean;
  showDate?: boolean;
  /** false logo após um arrasto: o clique sintético não abre a tarefa. */
  canOpen: () => boolean;
  onOpen: () => void;
  onToggle: (done: boolean) => void;
};

const ring = "group-focus-visible/card:ring-2 group-focus-visible/card:ring-ring/60";

/** Cartão pendente: ordenável (os vizinhos abrem espaço pelo transform do dnd-kit). */
export function WeekCard({ colId, droppable, ...c }: Common & { colId: string; droppable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: c.task.id,
    data: { colId },
    // Atrasadas: arrastável como origem, mas não aceita soltar.
    disabled: droppable ? false : { droppable: true },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-task-id={c.task.id}
      className="group/card outline-none"
      {...attributes}
      aria-roledescription="tarefa arrastável"
      {...listeners}
      onKeyDown={(e) => {
        // Enter abre a tarefa; Espaço levanta o cartão (ver keyboardCodes no DndContext).
        if (e.key === "Enter" && !isDragging && e.target === e.currentTarget) {
          e.preventDefault();
          c.onOpen();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    >
      <Pop presence={c.presence}>
        <CardBody
          task={c.task}
          today={c.today}
          tomorrow={c.tomorrow}
          showDate={c.showDate}
          ghost={isDragging}
          onToggle={c.onToggle}
          onClick={() => c.canOpen() && c.onOpen()}
          className={ring}
        />
      </Pop>
    </div>
  );
}

/** Cartão de tarefa concluída: esmaecido e não arrastável. */
export function WeekDoneCard(c: Common) {
  return (
    <div
      data-task-id={c.task.id}
      tabIndex={0}
      className="group/card outline-none"
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && c.onOpen()}
    >
      <Pop presence={c.presence}>
        <CardBody task={c.task} done today={c.today} tomorrow={c.tomorrow} onToggle={c.onToggle} onClick={c.onOpen} className={ring} />
      </Pop>
    </div>
  );
}

/** Cartão "levantado" no DragOverlay: escala, giro leve e sombra. */
export function LiftedCard({ task, today, tomorrow }: { task: Task; today: string; tomorrow: string }) {
  return (
    <motion.div
      initial={{ scale: 1, rotate: 0, boxShadow: "0 0 0 rgba(0,0,0,0)" }}
      animate={{ scale: 1.03, rotate: 2, boxShadow: "0 14px 32px rgba(0,0,0,0.25)" }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="rounded-lg"
    >
      <CardBody task={task} today={today} tomorrow={tomorrow} className="cursor-grabbing" />
    </motion.div>
  );
}

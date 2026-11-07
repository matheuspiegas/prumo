import { Check, Sparkles, Trash2, X } from "lucide-react";
import { motion, Reorder } from "motion/react";
import { useRef, useState, type Ref } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { dueLabel, type Task } from "@/lib/api";
import { rowVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

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
}: {
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
}) {
  const justDragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const label = dueLabel(task.due, today, tomorrow);
  const overdue = !!task.due && !done && task.due < today;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const className = cn(
    "group relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent",
    dragging && "z-10 bg-background",
  );
  const common = {
    ref,
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
        <span onClick={stop}>
          <Checkbox checked={done} onCheckedChange={(c) => onToggle(c === true)} aria-label="Concluir" />
        </span>
      )}
      <span className="min-w-0 flex-1 text-sm">
        <motion.span
          className={cn("relative inline-block max-w-full truncate align-bottom", done && "text-muted-foreground")}
          animate={{ opacity: done ? 0.55 : 1 }}
          transition={{ duration: 0.3 }}
        >
          {task.title}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-0 left-0 h-px origin-left bg-current"
            initial={false}
            animate={{ scaleX: done ? 1 : 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />
        </motion.span>
      </span>
      {task.source !== "manual" && (
        <Badge variant="secondary" className="gap-1 capitalize">
          <Sparkles className="size-3" />
          {task.source}
        </Badge>
      )}
      {label && (
        <span className={cn("text-xs text-muted-foreground", overdue && "font-medium text-destructive")}>
          {label}
        </span>
      )}
      <span className="flex items-center gap-1" onClick={stop}>
        {inbox ? (
          <>
            <Button size="sm" variant="outline" onClick={(e) => onApprove(e.currentTarget.closest("li"))}>
              <Check data-icon="inline-start" /> Aprovar
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Descartar">
              <X />
            </Button>
          </>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={onDelete}
            aria-label="Excluir"
          >
            <Trash2 />
          </Button>
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

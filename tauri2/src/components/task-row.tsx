import { Check, Sparkles, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { dueLabel, type Task } from "@/lib/api";
import { cn } from "@/lib/utils";

export function TaskRow({
  task,
  today,
  tomorrow,
  inbox,
  onOpen,
  onToggle,
  onDelete,
  onApprove,
}: {
  task: Task;
  today: string;
  tomorrow: string;
  inbox: boolean;
  onOpen: () => void;
  onToggle: (done: boolean) => void;
  onDelete: () => void;
  onApprove: () => void;
}) {
  const label = dueLabel(task.due, today, tomorrow);
  const overdue = !!task.due && !task.done && task.due < today;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <li
      onClick={onOpen}
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent"
    >
      {!inbox && (
        <span onClick={stop}>
          <Checkbox checked={task.done} onCheckedChange={(c) => onToggle(c === true)} aria-label="Concluir" />
        </span>
      )}
      <span className={cn("min-w-0 flex-1 truncate text-sm", task.done && "text-muted-foreground line-through")}>
        {task.title}
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
            <Button size="sm" variant="outline" onClick={onApprove}>
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
    </li>
  );
}

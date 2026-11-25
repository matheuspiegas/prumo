import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Texto do identificador (`#42`): o mesmo que a busca, o CLI e o MCP entendem. */
export const taskIdLabel = (id: number) => `#${id}`;

/** Identificador discreto da tarefa. Com `copyable`, um clique copia `#id` (sem abrir a tarefa). */
export function TaskId({ id, copyable, className }: { id: number; copyable?: boolean; className?: string }) {
  const base = "shrink-0 text-xs text-muted-foreground tabular-nums";
  const label = taskIdLabel(id);
  if (!copyable) {
    return (
      <span className={cn(base, className)} title={`Tarefa ${label}`}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cn(base, "rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50", className)}
      title={`Copiar ${label}`}
      aria-label={`Copiar identificador ${label}`}
      onClick={() => navigator.clipboard.writeText(label).then(() => toast.success(`${label} copiado`), () => toast.error("Não foi possível copiar"))}
    >
      {label}
    </button>
  );
}

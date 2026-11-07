import { CalendarCheck, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Task } from "@/lib/api";

/** Cabeçalho "Atrasadas (n)" em vermelho; as linhas (TaskRow) entram como `children`. */
export function OverdueSection({
  tasks,
  onRescheduleAll,
  children,
}: {
  tasks: Task[];
  onRescheduleAll: () => void;
  children: React.ReactNode;
}) {
  if (tasks.length === 0) return null;
  return (
    <section aria-label="Tarefas atrasadas" className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-destructive">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4" />
          Atrasadas <span className="font-normal">({tasks.length})</span>
        </h2>
        {tasks.length > 1 && (
          <Button size="xs" variant="ghost" className="text-destructive" onClick={onRescheduleAll}>
            <CalendarCheck data-icon="inline-start" /> Reagendar todas para hoje
          </Button>
        )}
      </div>
      <ul className="-mx-3 flex flex-col gap-0.5 rounded-lg bg-destructive/5 py-1">{children}</ul>
    </section>
  );
}

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, CalendarClock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Task } from "@/lib/api";
import { DUR_BASE, easeOut, softSpring } from "@/lib/motion";

/** Cabeçalho "Atrasadas (n)" em vermelho; as linhas (TaskRow) entram como `children`. Colapsável. */
export function OverdueSection({
  tasks,
  onRescheduleAll,
  children,
}: {
  tasks: Task[];
  onRescheduleAll: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (tasks.length === 0) return null;
  return (
    <motion.section
      aria-label="Tarefas atrasadas"
      className="flex flex-col gap-1"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR_BASE, ease: easeOut }}
    >
      <div className="flex items-center justify-between gap-2 text-destructive">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <CalendarClock className="size-4" />
          <h2 className="flex items-center gap-1 text-sm font-semibold">
            Atrasadas{" "}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={tasks.length}
                className="font-normal tabular-nums"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.15 }}
              >
                ({tasks.length})
              </motion.span>
            </AnimatePresence>
          </h2>
          <motion.span className="flex" animate={{ rotate: open ? 0 : -90 }} transition={softSpring}>
            <ChevronDown className="size-4" />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {tasks.length > 1 && (
            <motion.span
              key="all"
              className="flex"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: DUR_BASE, ease: easeOut }}
            >
              <Button size="xs" variant="ghost" className="text-destructive" onClick={onRescheduleAll}>
                <CalendarCheck data-icon="inline-start" /> Reagendar todas para hoje
              </Button>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="lista"
            className="-mx-3 overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DUR_BASE, ease: easeOut }}
          >
            <ul className="flex flex-col gap-0.5 rounded-lg bg-destructive/5 py-1">{children}</ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

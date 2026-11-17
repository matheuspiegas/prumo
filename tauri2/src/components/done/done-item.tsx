import { motion } from "motion/react";
import { CalendarCheck, Clock, Repeat } from "lucide-react";
import { recurrenceLabel } from "@/components/recurrence-select";
import { PriorityDot } from "@/components/priority-select";
import { TagChip } from "@/components/tag-chip";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dueLabel, type CompletedItem } from "@/lib/api";
import { doneDate, doneTime, punctuality } from "@/lib/done";
import { bouncy, DUR_BASE, easeOut } from "@/lib/motion";
import { cn } from "@/lib/utils";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Selo "No prazo" / "2 dias antes" / "3 dias depois": cor + ícone + texto (nunca só cor). */
export function PunctualityBadge({ due, completedOn, today, tomorrow }: { due: string | null; completedOn: string; today: string; tomorrow: string }) {
  const p = punctuality(due, completedOn);
  if (!p) return null;
  const late = p.kind === "late";
  const Icon = late ? Clock : CalendarCheck;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] leading-4 font-medium",
              late
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-green-500/10 text-green-700 dark:text-green-400",
            )}
          />
        }
      >
        <Icon className="size-3" aria-hidden />
        {p.label}
      </TooltipTrigger>
      <TooltipContent>Prevista para {dueLabel(due, today, tomorrow)?.toLowerCase()}</TooltipContent>
    </Tooltip>
  );
}

type Props = {
  item: CompletedItem;
  today: string;
  tomorrow: string;
  /** "row": linha da lista (hora à esquerda); "card": cartão das colunas. */
  variant: "row" | "card";
  onOpen: () => void;
  onReopen: () => void;
};

/**
 * Tarefa concluída sem o visual "riscado e apagado": aqui tudo já está concluído, então o título
 * fica legível e o destaque vai para QUANDO foi concluída e se foi no prazo.
 */
export function DoneItem({ item, today, tomorrow, variant, onOpen, onReopen }: Props) {
  const t = item.task;
  const time = doneTime(item);
  const meta = (
    <>
      <PunctualityBadge due={t.due} completedOn={doneDate(item)} today={today} tomorrow={tomorrow} />
      <PriorityDot priority={t.priority} />
      {t.recurrence && (
        <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label={recurrenceLabel(t.recurrence)}>
          <title>{recurrenceLabel(t.recurrence)}</title>
        </Repeat>
      )}
      {t.tags.slice(0, 2).map((g) => (
        <TagChip key={g} name={g} />
      ))}
      {t.tags.length > 2 && <span className="text-xs text-muted-foreground">+{t.tags.length - 2}</span>}
    </>
  );
  const check = (
    <motion.span onClick={stop} onKeyDown={stop} className="flex" whileTap={{ scale: 0.85 }} transition={bouncy}>
      <Checkbox checked onCheckedChange={(c) => c === false && onReopen()} aria-label={`Reabrir “${t.title}”`} title="Reabrir" />
    </motion.span>
  );
  const enter = {
    layout: "position" as const,
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: { duration: DUR_BASE, ease: easeOut } },
    exit: { opacity: 0, x: 24, transition: { duration: 0.18 } },
  };

  if (variant === "card") {
    return (
      <motion.li
        {...enter}
        data-task-id={t.id}
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen()}
        className="mb-2 flex cursor-pointer select-none flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-sm shadow-xs outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <div className="flex items-start gap-2">
          <span className="pt-0.5">{check}</span>
          <span className="min-w-0 flex-1 break-words leading-snug">{t.title}</span>
          <span className="pt-px text-xs text-muted-foreground tabular-nums" title="Concluída às">
            {time}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 empty:hidden">{meta}</div>
      </motion.li>
    );
  }

  return (
    <motion.li
      {...enter}
      data-task-id={t.id}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen()}
      className="group flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums" title="Concluída às">
        {time}
      </span>
      {check}
      <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
      <span className="flex shrink-0 items-center gap-2 empty:hidden">{meta}</span>
    </motion.li>
  );
}

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/date-picker";
import { PrioritySelect } from "@/components/priority-select";
import { RecurrenceSelect } from "@/components/recurrence-select";
import { TagInput } from "@/components/tag-input";
import { TimeField } from "@/components/time-field";
import { cn } from "@/lib/utils";

type Props = {
  /** `rows`: rótulo à esquerda, para o diálogo compacto. `stacked`: rótulo em cima, para o painel lateral. */
  layout: "rows" | "stacked";
  date: string | null;
  onDate: (v: string | null) => void;
  time: string | null;
  onTime: (v: string | null) => void;
  priority: number;
  onPriority: (v: number) => void;
  recurrence: string | null;
  onRecurrence: (v: string | null) => void;
  tags: string[];
  onTags: (v: string[]) => void;
};

function Field({ label, layout, children }: { label: string; layout: Props["layout"]; children: ReactNode }) {
  return (
    <div className={cn(layout === "rows" ? "grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3" : "flex flex-col gap-1.5")}>
      <Label className={cn(layout === "rows" && "text-muted-foreground")}>{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Data, hora, prioridade, repetição e tags da tarefa. */
export function TaskProperties({ layout, date, onDate, time, onTime, priority, onPriority, recurrence, onRecurrence, tags, onTags }: Props) {
  return (
    <div className={cn("flex flex-col", layout === "rows" ? "gap-2.5" : "gap-4")}>
      <Field label="Data" layout={layout}>
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker value={date} onChange={onDate} />
          <TimeField value={time} onChange={onTime} />
        </div>
      </Field>
      <Field label="Prioridade" layout={layout}>
        <PrioritySelect value={priority} onChange={onPriority} />
      </Field>
      <Field label="Repetir" layout={layout}>
        <RecurrenceSelect value={recurrence} onChange={onRecurrence} />
      </Field>
      <Field label="Tags" layout={layout}>
        <TagInput value={tags} onChange={onTags} />
      </Field>
    </div>
  );
}

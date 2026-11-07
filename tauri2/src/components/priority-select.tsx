import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

/** 0 nenhuma, 1 baixa, 2 média, 3 alta. */
export const PRIORITIES = [
  { value: 0, label: "Nenhuma", color: "text-muted-foreground" },
  { value: 1, label: "Baixa", color: "text-sky-500" },
  { value: 2, label: "Média", color: "text-amber-500" },
  { value: 3, label: "Alta", color: "text-red-500" },
] as const;

/** Indicador sutil na linha da tarefa (nada para prioridade 0). */
export function PriorityDot({ priority }: { priority: number }) {
  const p = PRIORITIES[priority];
  if (!p || priority === 0) return null;
  return (
    <span title={`Prioridade ${p.label.toLowerCase()}`} className="flex shrink-0 items-center">
      <Flag className={cn("size-3.5 fill-current", p.color)} aria-hidden />
      <span className="sr-only">Prioridade {p.label.toLowerCase()}</span>
    </span>
  );
}

/** Seletor segmentado (radiogroup) de prioridade. */
export function PrioritySelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Prioridade" className="flex gap-1">
      {PRIORITIES.map((p) => {
        const active = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`Prioridade: ${p.label.toLowerCase()}`}
            onClick={() => onChange(p.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active ? "border-primary bg-accent font-medium" : "border-input text-muted-foreground",
            )}
          >
            {p.value > 0 && <Flag className={cn("size-3.5 fill-current", p.color)} aria-hidden />}
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

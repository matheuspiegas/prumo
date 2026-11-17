import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fromIso } from "@/lib/api";
import { plural, type Bucket } from "@/lib/done";
import { cn } from "@/lib/utils";

const HEIGHT = 56;

const short = (iso: string) => {
  const d = fromIso(iso);
  return d ? format(d, "d MMM", { locale: ptBR }) : iso;
};

function bucketLabel(b: Bucket, by: "day" | "week") {
  if (by === "day") {
    const d = fromIso(b.from);
    return d ? format(d, "EEE, d MMM", { locale: ptBR }) : b.from;
  }
  return b.from === b.to ? short(b.from) : `${short(b.from)} – ${short(b.to)}`;
}

/**
 * Mini gráfico de barras: concluídas por dia (ou por semana em períodos longos). Uma série só,
 * na cor primária; sem legenda (o título da seção já diz o que é). Clicar numa barra filtra a
 * lista por aquele dia/semana; clicar de novo desfaz.
 */
export function DoneChart({
  by,
  list,
  selected,
  onSelect,
}: {
  by: "day" | "week";
  list: Bucket[];
  selected: string | null;
  onSelect: (b: Bucket | null) => void;
}) {
  if (list.length < 2) return null;
  const max = Math.max(1, ...list.map((b) => b.count));
  return (
    <figure className="flex flex-col gap-1" aria-label={`Concluídas por ${by === "day" ? "dia" : "semana"}`}>
      <div className="flex items-end gap-0.5" style={{ height: HEIGHT }} role="list">
        {list.map((b) => {
          const active = selected === b.key;
          const dim = selected !== null && !active;
          // Altura mínima visível para valores > 0; zero vira só uma linha de base.
          const h = b.count === 0 ? 2 : Math.max(4, Math.round((b.count / max) * HEIGHT));
          const label = `${bucketLabel(b, by)} · ${plural(b.count, "concluída", "concluídas")}`;
          return (
            <Tooltip key={b.key}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="listitem"
                    aria-label={label}
                    aria-pressed={active}
                    onClick={() => onSelect(active ? null : b)}
                    // A área clicável ocupa a coluna inteira (mais fácil de acertar que a barra).
                    className="group flex h-full max-w-6 min-w-0 flex-1 cursor-pointer items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  />
                }
              >
                <span
                  className={cn(
                    "w-full rounded-t-[4px] transition-[opacity,background-color,height] duration-200",
                    b.count === 0 ? "bg-border" : "bg-primary group-hover:bg-primary/80",
                    dim && "opacity-35",
                  )}
                  style={{ height: h }}
                />
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <figcaption className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{short(list[0].from)}</span>
        <span>{short(list[list.length - 1].to)}</span>
      </figcaption>
    </figure>
  );
}

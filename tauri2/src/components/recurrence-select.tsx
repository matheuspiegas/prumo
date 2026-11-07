import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { DUR_BASE, DUR_FAST, easeOut } from "@/lib/motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "none";
const CUSTOM = "custom";
const PRESETS: Record<string, string> = {
  "day:1": "Todo dia",
  "week:1": "Toda semana",
  "week:2": "A cada 2 semanas",
  "month:1": "Todo mês",
};
const UNITS: Record<string, string> = { day: "dia(s)", week: "semana(s)", month: "mês(es)" };

/** Texto curto para tooltips: "Todo dia", "A cada 3 meses"... */
export function recurrenceLabel(rec: string | null) {
  if (!rec) return "Não repete";
  if (PRESETS[rec]) return PRESETS[rec];
  const [u, n] = rec.split(":");
  const unit = { day: ["dia", "dias"], week: ["semana", "semanas"], month: ["mês", "meses"] }[u];
  return unit ? `A cada ${n} ${Number(n) === 1 ? unit[0] : unit[1]}` : rec;
}

export function RecurrenceSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (rec: string | null) => void;
}) {
  const isCustom = !!value && !PRESETS[value];
  // "Personalizado" escolhido mas ainda sem valor próprio diferente dos presets.
  const [forceCustom, setForceCustom] = useState(false);
  const custom = isCustom || forceCustom;
  const [unit, n] = value?.split(":") ?? ["day", "1"];

  const items = [
    { value: NONE, label: "Não repete" },
    ...Object.entries(PRESETS).map(([value, label]) => ({ value, label })),
    { value: CUSTOM, label: "Personalizado" },
  ];
  const selected = custom ? CUSTOM : (value ?? NONE);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={items}
        value={selected}
        onValueChange={(v) => {
          if (v === CUSTOM) {
            setForceCustom(true);
            if (!value) onChange("day:1");
          } else {
            setForceCustom(false);
            onChange(v === NONE ? null : (v as string));
          }
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AnimatePresence initial={false}>
      {custom && (
        <motion.div
          key="custom"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0, transition: { duration: DUR_BASE, ease: easeOut } }}
          exit={{ opacity: 0, x: -8, transition: { duration: DUR_FAST } }}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-sm text-muted-foreground">a cada</span>
          <Input
            type="number"
            min={1}
            max={999}
            className="w-20"
            value={n}
            onChange={(e) => {
              const k = Math.min(999, Math.max(1, Math.floor(Number(e.target.value)) || 1));
              onChange(`${unit}:${k}`);
            }}
          />
          <Select
            items={Object.entries(UNITS).map(([value, label]) => ({ value, label }))}
            value={unit}
            onValueChange={(u) => onChange(`${u}:${n}`)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(UNITS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

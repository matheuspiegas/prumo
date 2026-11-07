import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { TagChip } from "@/components/tag-chip";
import { api } from "@/lib/api";
import { popIn } from "@/lib/motion";

const clean = (s: string) => s.trim().replace(/^#+/, "").trim();

/** Chips de tags com autocomplete. Enter/vírgula cria, Backspace remove a última. */
export function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const [known, setKnown] = useState<string[]>([]);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    api.tags().then((t) => setKnown(t.map((x) => x.name))).catch(() => {});
  }, []);

  const has = (n: string) => value.some((v) => v.toLowerCase() === n.toLowerCase());
  const add = (raw: string) => {
    const n = clean(raw);
    if (n && !has(n)) onChange([...value, known.find((k) => k.toLowerCase() === n.toLowerCase()) ?? n]);
    setText("");
  };

  const q = clean(text).toLowerCase();
  const suggestions = known.filter((k) => !has(k) && (!q || k.toLowerCase().includes(q))).slice(0, 6);

  return (
    <div className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <AnimatePresence initial={false}>
        {value.map((t) => (
          <motion.span key={t} layout variants={popIn} initial="hidden" animate="show" exit="exit" className="inline-flex">
          <TagChip name={t}>
            <button
              type="button"
              aria-label={`Remover ${t}`}
              className="opacity-60 hover:opacity-100"
              onClick={() => onChange(value.filter((v) => v !== t))}
            >
              <X className="size-3" />
            </button>
          </TagChip>
          </motion.span>
        ))}
        </AnimatePresence>
        <input
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) {
              v.split(",").forEach((p, i, a) => i < a.length - 1 && add(p));
              setText(v.slice(v.lastIndexOf(",") + 1));
            } else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Enter com texto cria a tag; sem texto deixa o formulário salvar.
              if (clean(text)) {
                e.preventDefault();
                add(text);
              }
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false);
            if (clean(text)) add(text);
          }}
          placeholder={value.length ? "" : "Adicionar tag…"}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {focus && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 flex w-full flex-wrap gap-1.5 rounded-lg border bg-popover p-2 shadow-md">
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)}>
                <TagChip name={s} className="cursor-pointer hover:brightness-95" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

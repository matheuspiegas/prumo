import { Search, X } from "lucide-react";
import { useState, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Input } from "@/components/ui/input";
import { isMac } from "@/hooks/use-shortcuts";
import { popIn, softSpring } from "@/lib/motion";

/** Campo de busca do cabeçalho. Esc limpa e tira o foco do campo. */
export function SearchBox({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <motion.div className="relative" initial={false} animate={{ width: focused || value ? 240 : 176 }} transition={softSpring}>
      <motion.span
        className="pointer-events-none absolute top-1/2 left-2.5 -mt-2 text-muted-foreground"
        animate={{ scale: focused ? 1.1 : 1 }}
        transition={{ duration: 0.15 }}
      >
        <Search className="size-4" />
      </motion.span>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
            e.currentTarget.blur();
          }
        }}
        placeholder={`Buscar (${isMac ? "⌘" : "Ctrl+"}K)`}
        aria-label="Buscar tarefas"
        className="pr-8 pl-8"
      />
      <AnimatePresence>
        {value && (
          <motion.button
            type="button"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            whileTap={{ scale: 0.85 }}
            onClick={() => onChange("")}
            aria-label="Limpar busca"
            className="absolute top-1/2 right-2 -mt-2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

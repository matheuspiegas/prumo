import { Search, X } from "lucide-react";
import type { Ref } from "react";
import { Input } from "@/components/ui/input";
import { isMac } from "@/hooks/use-shortcuts";

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
  return (
    <div className="relative w-44 transition-[width] focus-within:w-60">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpar busca"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

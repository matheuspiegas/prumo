import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isMac } from "@/hooks/use-shortcuts";

const MOD = isMac ? "⌘" : "Ctrl";

/** Atalhos de teclado do editor (os do Tiptap/ProseMirror). */
const KEYS: [string[], string][] = [
  [[MOD, "B"], "Negrito"],
  [[MOD, "I"], "Itálico"],
  [[MOD, "Shift", "S"], "Riscado"],
  [[MOD, "E"], "Código em linha"],
  [[MOD, "Alt", "1–3"], "Título 1 a 3"],
  [[MOD, "Shift", "8"], "Lista"],
  [[MOD, "Shift", "7"], "Lista numerada"],
  [[MOD, "Shift", "9"], "Checklist"],
  [[MOD, "Shift", "B"], "Citação"],
  [[MOD, "Alt", "C"], "Bloco de código"],
  [[MOD, "Z"], "Desfazer"],
  [[MOD, "Shift", "Z"], "Refazer"],
  [["Shift", "Enter"], "Quebra de linha"],
  [[MOD, "Enter"], "Salvar a tarefa"],
];

/** Atalhos de digitação em markdown: escreva o trecho e o editor converte. */
const TYPING: [string, string][] = [
  ["# ", "Título 1 (## título 2, ### título 3)"],
  ["- ", "Lista"],
  ["1. ", "Lista numerada"],
  ["[ ] ", "Checklist"],
  ["> ", "Citação"],
  ["```", "Bloco de código"],
  ["**texto**", "Negrito"],
  ["*texto*", "Itálico"],
  ["~~texto~~", "Riscado"],
  ["`texto`", "Código em linha"],
  ["---", "Linha separadora"],
];

const Kbd = ({ children }: { children: string }) => (
  <kbd className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">{children}</kbd>
);

/** Botão "?" da barra do editor: lista os atalhos de teclado e de digitação do markdown. */
export function MarkdownHelp() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Atalhos do markdown"
            aria-label="Atalhos do markdown"
            onMouseDown={(e) => e.preventDefault()}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-4"
          />
        }
      >
        <CircleHelp />
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(28rem,70dvh)] w-[22rem] overflow-y-auto p-3">
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Atalhos de teclado</h3>
          {KEYS.map(([keys, label]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-sm">
              <span>{label}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </section>
        <section className="mt-4 flex flex-col gap-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Digitando markdown</h3>
          {TYPING.map(([typed, label]) => (
            <div key={typed} className="flex items-center justify-between gap-3 text-sm">
              <span>{label}</span>
              <code className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-pre">{typed}</code>
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">
            Cole uma imagem com {MOD}+V: ela entra como <code className="font-mono">[Image #N]</code>.
          </p>
        </section>
      </PopoverContent>
    </Popover>
  );
}

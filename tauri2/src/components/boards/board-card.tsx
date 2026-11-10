import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, MoreHorizontal, PenLine, PenTool, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, type Board } from "@/lib/api";
import { cn } from "@/lib/utils";

/** O banco guarda `datetime('now')` (UTC, sem fuso); aceita também ISO com fuso. */
function parseDate(s: string): Date | null {
  const d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? new Date(s.replace(" ", "T") + "Z") : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "atualizado há 3 minutos" (vazio se a data for inválida). */
export function updatedAgo(updatedAt: string): string {
  const d = parseDate(updatedAt);
  return d ? `atualizado ${formatDistanceToNow(d, { addSuffix: true, locale: ptBR })}` : "";
}

/** Campo de nome: Enter ou sair do campo grava; Esc cancela; vazio ou igual ao anterior não grava. */
export function NameInput({
  value,
  label,
  className,
  onCommit,
  onDone,
}: {
  value: string;
  label: string;
  className?: string;
  onCommit: (name: string) => void;
  /** Sempre chamado ao terminar a edição (gravando ou não). */
  onDone: () => void;
}) {
  const [text, setText] = useState(value);
  const finished = useRef(false);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const name = text.trim();
    if (save && name && name !== value) onCommit(name);
    onDone();
  };
  return (
    <Input
      autoFocus
      aria-label={label}
      value={text}
      maxLength={120}
      className={cn("h-7 px-1.5 text-sm", className)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation(); // não fecha diálogos/vistas por trás
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** Miniatura do quadro: baixa os bytes, vira URL de objeto e a revoga ao desmontar ou trocar. */
function Thumbnail({ board }: { board: Board }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!board.hasThumbnail) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let made: string | null = null;
    api.boards
      .readThumbnail(board.id)
      .then((buf) => {
        if (cancelled) return;
        made = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
        setUrl(made);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [board.id, board.hasThumbnail, board.updatedAt]);

  if (!url) {
    return (
      <div data-testid="thumb-placeholder" className="grid size-full place-items-center bg-muted/60 text-muted-foreground/60">
        <PenTool className="size-8" aria-hidden />
      </div>
    );
  }
  return <img src={url} alt="" draggable={false} className="size-full bg-white object-cover object-top-left" />;
}

export function BoardCard({
  board,
  renaming,
  onOpen,
  onStartRename,
  onRename,
  onStopRename,
  onDuplicate,
  onDelete,
}: {
  board: Board;
  renaming: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onStopRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  const item =
    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground transition-shadow focus-within:shadow-md hover:shadow-md">
      <button
        type="button"
        aria-label={`Abrir quadro ${board.name}`}
        onClick={onOpen}
        className="block aspect-[4/3] w-full overflow-hidden border-b outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Thumbnail board={board} />
      </button>
      <div className="flex min-h-[3.25rem] flex-col justify-center gap-0.5 px-3 py-2 pr-11">
        {renaming ? (
          <NameInput value={board.name} label="Nome do quadro" onCommit={onRename} onDone={onStopRename} />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={onOpen}
            className="truncate text-left text-sm font-medium outline-none"
            title={board.name}
          >
            {board.name}
          </button>
        )}
        <span className="truncate text-xs text-muted-foreground">{updatedAgo(board.updatedAt)}</span>
      </div>
      <div className="absolute right-2 bottom-2">
        <Popover open={menu} onOpenChange={setMenu}>
          <PopoverTrigger
            render={<Button variant="ghost" size="icon" />}
            aria-label={`Ações do quadro ${board.name}`}
            className={cn(
              "size-8 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100",
            )}
          >
            <MoreHorizontal />
          </PopoverTrigger>
          <PopoverContent align="end" side="top" finalFocus={false} className="w-40 gap-0.5 p-1">
            <button type="button" className={item} onClick={act(onStartRename)}>
              <PenLine className="size-4" /> Renomear
            </button>
            <button type="button" className={item} onClick={act(onDuplicate)}>
              <Copy className="size-4" /> Duplicar
            </button>
            <button type="button" className={cn(item, "text-destructive")} onClick={act(onDelete)}>
              <Trash2 className="size-4" /> Excluir
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </li>
  );
}

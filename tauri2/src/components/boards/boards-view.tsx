import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Check, CircleAlert, Copy, Loader2, MoreHorizontal, PenTool, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { api, type Board } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BoardCard, NameInput } from "./board-card";
import { ConfirmDeleteBoard } from "./confirm-delete-board";

// O Excalidraw é pesado: só carrega quando um quadro é aberto.
const BoardCanvas = lazy(() => import("./board-canvas").then((m) => ({ default: m.BoardCanvas })));

type SaveState = "saving" | "saved" | "error";

/** Aba Quadros: lista de quadros e, ao abrir um, o canvas em tela cheia com uma barra fina no topo. */
export function BoardsView() {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [open, setOpen] = useState<Board | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<Board | null>(null);
  const alive = useRef(true);

  const load = useCallback(() => {
    api.boards
      .list()
      .then((list) => {
        if (!alive.current) return;
        setBoards(list);
        // Mantém o nome do quadro aberto em dia (renomeado em outro lugar).
        setOpen((o) => (o ? (list.find((b) => b.id === o.id) ?? o) : o));
      })
      .catch((e) => {
        if (alive.current) {
          setBoards((b) => b ?? []);
          toast.error(String(e));
        }
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const sub = listen("boards-changed", load);
    return () => {
      alive.current = false;
      sub.then((un) => un());
    };
  }, [load]);

  const fail = (e: unknown) => toast.error(String(e));
  const create = () =>
    api.boards
      .create()
      .then((b) => {
        setOpen(b);
        load();
      })
      .catch(fail);
  const rename = (b: Board, name: string) => {
    // Otimista: o nome já muda na tela; o evento do backend confirma.
    setBoards((l) => l?.map((x) => (x.id === b.id ? { ...x, name } : x)) ?? l);
    setOpen((o) => (o?.id === b.id ? { ...o, name } : o));
    api.boards.rename(b.id, name).catch((e) => {
      fail(e);
      load();
    });
  };
  const duplicate = (b: Board) =>
    api.boards
      .duplicate(b.id)
      .then((c) => {
        toast.success(`Cópia criada: ${c.name}`);
        load();
      })
      .catch(fail);
  const confirmDelete = () => {
    const b = toDelete;
    setToDelete(null);
    if (!b) return;
    api.boards
      .remove(b.id)
      .then(() => {
        if (open?.id === b.id) setOpen(null);
        load();
      })
      .catch(fail);
  };
  const back = () => {
    setOpen(null);
    load();
  };

  return (
    <>
      {open ? (
        <OpenBoard board={open} onBack={back} onRename={(n) => rename(open, n)} onDuplicate={() => duplicate(open)} onDelete={() => setToDelete(open)} />
      ) : (
        <div className="h-full overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 px-8 pt-8 pb-8">
            <header className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Quadros</h1>
                <p className="mt-1 text-sm text-muted-foreground">Quadros brancos infinitos para diagramas, fluxos e anotações.</p>
              </div>
              <Button onClick={create}>
                <Plus data-icon="inline-start" /> Novo quadro
              </Button>
            </header>

            {boards === null ? (
              <ul aria-label="Carregando quadros" className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="overflow-hidden rounded-lg border">
                    <Skeleton className="aspect-[4/3] rounded-none" />
                    <div className="flex flex-col gap-2 px-3 py-3">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : boards.length === 0 ? (
              <EmptyState icon={PenTool} title="Nenhum quadro ainda." hint="Crie um quadro para desenhar fluxos e diagramas." />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
                {boards.map((b) => (
                  <BoardCard
                    key={b.id}
                    board={b}
                    renaming={renamingId === b.id}
                    onOpen={() => setOpen(b)}
                    onStartRename={() => setRenamingId(b.id)}
                    onRename={(n) => rename(b, n)}
                    onStopRename={() => setRenamingId((id) => (id === b.id ? null : id))}
                    onDuplicate={() => duplicate(b)}
                    onDelete={() => setToDelete(b)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <ConfirmDeleteBoard board={toDelete} onCancel={() => setToDelete(null)} onConfirm={confirmDelete} />
    </>
  );
}

const SAVE_LABEL: Record<SaveState, string> = { saving: "Salvando…", saved: "Salvo", error: "Erro ao salvar" };

/** Quadro aberto: barra fina (voltar, nome, gravação, menu) e o canvas ocupando o resto. */
function OpenBoard({
  board,
  onBack,
  onRename,
  onDuplicate,
  onDelete,
}: {
  board: Board;
  onBack: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [save, setSave] = useState<SaveState>("saved");
  const [menu, setMenu] = useState(false);
  const item =
    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring";
  const SaveIcon = save === "saving" ? Loader2 : save === "error" ? CircleAlert : Check;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Voltar para Quadros">
          <ArrowLeft data-icon="inline-start" /> Quadros
        </Button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <NameInput value={board.name} label="Nome do quadro" className="max-w-sm" onCommit={onRename} onDone={() => setEditing(false)} />
          ) : (
            <button
              type="button"
              title="Clique para renomear"
              aria-label={`Renomear quadro ${board.name}`}
              onClick={() => setEditing(true)}
              className="max-w-full truncate rounded-sm px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              {board.name}
            </button>
          )}
        </div>
        <span
          role="status"
          className={cn("flex shrink-0 items-center gap-1 text-xs text-muted-foreground", save === "error" && "text-destructive")}
        >
          <SaveIcon className={cn("size-3.5", save === "saving" && "animate-spin")} aria-hidden />
          {SAVE_LABEL[save]}
        </span>
        <Popover open={menu} onOpenChange={setMenu}>
          <PopoverTrigger render={<Button variant="ghost" size="icon" />} aria-label="Mais ações do quadro" className="size-8 shrink-0">
            <MoreHorizontal />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 gap-0.5 p-1">
            <button
              type="button"
              className={item}
              onClick={() => {
                setMenu(false);
                onDuplicate();
              }}
            >
              <Copy className="size-4" /> Duplicar
            </button>
            <button
              type="button"
              className={cn(item, "text-destructive")}
              onClick={() => {
                setMenu(false);
                onDelete();
              }}
            >
              <Trash2 className="size-4" /> Excluir
            </button>
          </PopoverContent>
        </Popover>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando quadro…
              </span>
            </div>
          }
        >
          <BoardCanvas key={board.id} boardId={board.id} onSaveState={setSave} />
        </Suspense>
      </div>
    </div>
  );
}

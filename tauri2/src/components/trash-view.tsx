import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type TrashItem } from "@/lib/api";

const ago = (n: number) => (n <= 0 ? "hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`);
const left = (n: number) => (n <= 0 ? "descarte em breve" : n === 1 ? "falta 1 dia" : `faltam ${n} dias`);

/** Visão da lixeira: restaurar, excluir definitivamente e esvaziar. */
export function TrashView({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(() => {
    api.listTrash().then(setItems).catch((e) => toast.error(String(e)));
  }, []);
  useEffect(() => {
    load();
    const sub = listen("tasks-changed", load);
    return () => {
      sub.then((un) => un());
    };
  }, [load]);

  const act = (p: Promise<unknown>) =>
    p
      .then(() => {
        load();
        onChanged?.();
      })
      .catch((e) => toast.error(String(e)));

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-5 px-8 pt-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lixeira</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tarefas excluídas ficam aqui por 30 dias e depois são apagadas.
          </p>
        </div>
        <Button variant="outline" disabled={!items.length} onClick={() => setConfirm(true)}>
          <Trash2 data-icon="inline-start" /> Esvaziar lixeira
        </Button>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-24 text-muted-foreground">
          <Trash2 className="size-10" />
          <p className="text-sm">A lixeira está vazia.</p>
        </div>
      ) : (
        <ul className="-mx-3 flex flex-col gap-0.5 overflow-y-auto pb-8">
          {items.map(({ task, daysAgo, daysLeft }) => (
            <li key={task.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent">
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate">{task.title}</span>
                <span className="text-xs text-muted-foreground">
                  Excluída {ago(daysAgo)} · {left(daysLeft)}
                </span>
              </span>
              <Button size="sm" variant="outline" onClick={() => act(api.restore(task.id))}>
                <RotateCcw data-icon="inline-start" /> Restaurar
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Excluir definitivamente"
                title="Excluir definitivamente"
                onClick={() => act(api.purge(task.id))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Esvaziar a lixeira?</DialogTitle>
            <DialogDescription>
              {items.length === 1 ? "1 tarefa será apagada" : `${items.length} tarefas serão apagadas`} para sempre,
              com seus anexos. Não dá para desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                act(api.emptyTrash());
              }}
            >
              Esvaziar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

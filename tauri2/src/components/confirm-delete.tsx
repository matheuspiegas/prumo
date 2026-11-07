import { useRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Task } from "@/lib/api";

/** Confirmação antes de mandar uma tarefa para a lixeira. `task` nulo = fechado. */
export function ConfirmDelete({ task, onCancel, onConfirm }: { task: Task | null; onCancel: () => void; onConfirm: () => void }) {
  // Guarda a última tarefa para o texto não sumir durante a animação de fechar.
  const last = useRef<Task | null>(task);
  if (task) last.current = task;
  const t = last.current;
  const subs = t?.subtasksTotal ?? 0;
  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir tarefa?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">“{t?.title}”</span>
            {subs > 0 && ` e ${subs === 1 ? "sua subtarefa" : `suas ${subs} subtarefas`}`} vai para a lixeira por 30 dias. Dá para
            restaurar ou desfazer logo em seguida.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          {/* Foco no botão de excluir: Delete → Enter confirma sem tirar a mão do teclado. */}
          <Button variant="destructive" autoFocus onClick={onConfirm}>
            <Trash2 data-icon="inline-start" /> Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

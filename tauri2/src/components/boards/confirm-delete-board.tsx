import { useRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Board } from "@/lib/api";

/** Confirmação antes de excluir um quadro (definitivo, sem lixeira). `board` nulo = fechado. */
export function ConfirmDeleteBoard({ board, onCancel, onConfirm }: { board: Board | null; onCancel: () => void; onConfirm: () => void }) {
  // Guarda o último quadro para o texto não sumir durante a animação de fechar.
  const last = useRef<Board | null>(board);
  if (board) last.current = board;
  return (
    <Dialog open={!!board} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir quadro?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">“{last.current?.name}”</span> e a miniatura serão apagados. A exclusão é
            definitiva: não há lixeira para quadros.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <Trash2 data-icon="inline-start" /> Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

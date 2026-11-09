import { lazy, Suspense, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SubtasksList } from "@/components/subtasks-list";
import { TaskAttachments } from "@/components/task-attachments";
import { TaskProperties } from "@/components/task-properties";
import type { NotesEditorHandle } from "@/components/notes-editor/notes-editor";
import type { NoteImage } from "@/components/notes-editor/image-context";
import { useExpandedLayout } from "@/hooks/use-expanded-layout";
import { useTaskForm } from "@/hooks/use-task-form";
import { imageMime, type Task } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DUR_BASE, DUR_FAST, easeOut } from "@/lib/motion";

/** O editor (Tiptap) só é carregado ao abrir uma tarefa, para o app iniciar leve. */
const NotesEditor = lazy(() => import("@/components/notes-editor/notes-editor").then((m) => ({ default: m.NotesEditor })));

/** Campos do formulário entram em cascata curta (25 ms) ao abrir. */
const formVariants = { hidden: {}, show: { transition: { staggerChildren: 0.025, delayChildren: 0.04 } } };
const fieldVariants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: DUR_BASE, ease: easeOut } },
};

type Props = {
  open: boolean;
  /** `null` = nova tarefa */
  task: Task | null;
  defaultDate: string | null;
  /** Tags já aplicadas a uma tarefa nova (ex.: quando há um filtro de tag ativo). */
  defaultTags?: string[];
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Diálogo de criar/editar tarefa. Dois layouts sobre o mesmo estado: compacto (janela padrão, tudo em
 * uma coluna) e expandido (janela grande: editor amplo à esquerda e propriedades à direita).
 */
export function TaskDialog({ open, task, defaultDate, defaultTags, onClose, onSaved }: Props) {
  const f = useTaskForm({ open, task, defaultDate, defaultTags, onClose, onSaved });
  const expanded = useExpandedLayout();
  const editorRef = useRef<NotesEditorHandle>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  /** Fechar com alterações não salvas pede confirmação. */
  const requestClose = () => (f.dirty ? setConfirmClose(true) : onClose());

  const insertImage = (i: NoteImage) => editorRef.current?.insertImages([{ n: i.n, name: i.name }]);
  const removeImage = async (i: NoteImage) => {
    editorRef.current?.removeImage({ n: i.n, name: i.name });
    await f.removeImage({ n: i.n, name: i.name });
  };

  const titleInput = (
    <Input
      autoFocus
      value={f.title}
      onChange={(e) => f.setTitle(e.target.value)}
      placeholder="O que precisa ser feito?"
      className={cn(expanded ? "h-11 text-lg" : "h-10 text-base")}
    />
  );

  const properties = (
    <TaskProperties
      layout={expanded ? "stacked" : "rows"}
      date={f.date}
      onDate={f.setDate}
      time={f.time}
      onTime={f.setTime}
      priority={f.priority}
      onPriority={f.setPriority}
      recurrence={f.recurrence}
      onRecurrence={f.setRecurrence}
      tags={f.tags}
      onTags={f.setTags}
    />
  );

  const editor = (
    <Suspense fallback={<div className={cn("min-h-44 animate-pulse rounded-lg border bg-muted/30", expanded && "flex-1")} />}>
    <NotesEditor
      // Remonta ao abrir outra tarefa e ao trocar de layout; o texto atual vem de `f.notes`.
      key={`${f.resetKey}-${expanded}`}
      ref={editorRef}
      initialMarkdown={f.notes}
      images={f.images}
      variant={expanded ? "expanded" : "compact"}
      onChange={f.setNotes}
      onPasteImages={f.pasteImages}
      onSubmit={f.save}
      placeholder="Detalhes, links, contexto… Cole imagens com Ctrl+V."
      className={expanded ? "flex-1" : undefined}
    />
    </Suspense>
  );

  const subtasks = task && <SubtasksList parentId={task.id} onChanged={onSaved} />;

  const attachments = (
    <TaskAttachments
      files={f.saved.filter((a) => !imageMime(a.filename))}
      pending={f.pending}
      images={f.images}
      dragging={f.dragging}
      onChoose={f.chooseFiles}
      onRemoveFile={f.removeSaved}
      onRemovePending={(p) => f.setPending((cur) => cur.filter((x) => x !== p))}
      onInsertImage={insertImage}
      onRemoveImage={removeImage}
    />
  );

  const footer = (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={requestClose}>
        Cancelar
      </Button>
      <motion.span whileTap={{ scale: 0.96 }} transition={{ duration: DUR_FAST }} className="inline-flex">
        <Button type="submit" disabled={!f.title.trim() || f.saving} className="w-full">
          {f.saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {task ? "Salvar" : "Criar"}
        </Button>
      </motion.span>
    </DialogFooter>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      {/* Altura limitada à janela: cabeçalho e rodapé fixos, só o miolo rola. */}
      <DialogContent
        className={cn(
          "max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
          expanded ? "h-[calc(100dvh-3rem)] w-[calc(100%-3rem)] sm:max-w-6xl" : "sm:max-w-2xl",
        )}
      >
        <DialogHeader>
          <DialogTitle>{task ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
        </DialogHeader>
        <motion.form
          variants={formVariants}
          initial="hidden"
          animate="show"
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            f.save();
          }}
        >
          {expanded ? (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-6">
              <div className="flex min-h-0 flex-col gap-3">
                <motion.div variants={fieldVariants}>{titleInput}</motion.div>
                <motion.div variants={fieldVariants} className="flex min-h-0 flex-1 flex-col">
                  {editor}
                </motion.div>
              </div>
              <aside className="-mr-2 flex min-h-0 flex-col gap-5 overflow-y-auto py-1 pr-2">
                <motion.div variants={fieldVariants}>{properties}</motion.div>
                {subtasks && <motion.div variants={fieldVariants}>{subtasks}</motion.div>}
                <motion.div variants={fieldVariants}>{attachments}</motion.div>
              </aside>
            </div>
          ) : (
            <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-1">
              <motion.div variants={fieldVariants}>{titleInput}</motion.div>
              <motion.div variants={fieldVariants}>{properties}</motion.div>
              <motion.div variants={fieldVariants}>{editor}</motion.div>
              {subtasks && <motion.div variants={fieldVariants}>{subtasks}</motion.div>}
              <motion.div variants={fieldVariants}>{attachments}</motion.div>
            </div>
          )}
          {footer}
        </motion.form>

        <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
          <DialogContent className="sm:max-w-sm" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Descartar alterações?</DialogTitle>
              <DialogDescription>Esta tarefa tem alterações que ainda não foram salvas. Se fechar agora, elas se perdem.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" autoFocus onClick={() => setConfirmClose(false)}>
                Continuar editando
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmClose(false);
                  onClose();
                }}
              >
                Descartar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

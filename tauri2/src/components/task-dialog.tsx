import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as pickFiles } from "@tauri-apps/plugin-dialog";
import { FileText, Loader2, Paperclip, Plus, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/tag-input";
import { DatePicker } from "@/components/date-picker";
import { PrioritySelect } from "@/components/priority-select";
import { SubtasksList } from "@/components/subtasks-list";
import { RecurrenceSelect } from "@/components/recurrence-select";
import { TimeField } from "@/components/time-field";
import { api, baseName, formatSize, type Attachment, type Task } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DUR_BASE, DUR_FAST, easeOut } from "@/lib/motion";

/** Campos do formulário entram em cascata curta (25 ms) ao abrir. */
const formVariants = { hidden: {}, show: { transition: { staggerChildren: 0.025, delayChildren: 0.04 } } };
const fieldVariants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: DUR_BASE, ease: easeOut } },
};
/** Item de anexo: altura + fade ao entrar/sair. */
const itemMotion = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto", transition: { duration: DUR_BASE, ease: easeOut } },
  exit: { opacity: 0, height: 0, transition: { duration: DUR_FAST } },
} as const;

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

export function TaskDialog({ open, task, defaultDate, defaultTags, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [recurrence, setRecurrence] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [saved, setSaved] = useState<Attachment[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const loadAttachments = useCallback(async (id: number) => setSaved(await api.attachments(id)), []);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setDate(task ? task.due : defaultDate);
    setPriority(task?.priority ?? 0);
    setRecurrence(task?.recurrence ?? null);
    setTime(task?.dueTime ?? null);
    setPending([]);
    setSaved([]);
    setTags(task?.tags ?? defaultTags ?? []);
    if (task) loadAttachments(task.id).catch((e) => toast.error(String(e)));
  }, [open, task, defaultDate, defaultTags, loadAttachments]);

  const addPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      try {
        if (task) {
          for (const p of paths) await api.attach(task.id, p);
          await loadAttachments(task.id);
          onSaved();
        } else {
          setPending((cur) => [...cur, ...paths]);
        }
      } catch (e) {
        toast.error(`Não foi possível anexar: ${e}`);
      }
    },
    [task, loadAttachments, onSaved],
  );

  // Arrastar e soltar arquivos do Finder/Explorer (o webview entrega os caminhos).
  const addRef = useRef(addPaths);
  addRef.current = addPaths;
  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          addRef.current(p.paths);
        }
      })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)));
    return () => {
      cancelled = true;
      unlisten?.();
      setDragging(false);
    };
  }, [open]);

  const choose = async () => {
    const res = await pickFiles({ multiple: true });
    if (res) addPaths(Array.isArray(res) ? res : [res]);
  };

  const save = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      if (task) {
        await api.update(task.id, t, notes, date);
        if (priority !== task.priority) await api.setPriority(task.id, priority);
        if (recurrence !== (task.recurrence ?? null)) await api.setRecurrence(task.id, recurrence);
        if (time !== (task.dueTime ?? null)) await api.setTime(task.id, time);
        await api.setTags(task.id, tags);
      } else {
        const id = await api.add(t, notes, date);
        if (priority) await api.setPriority(id, priority);
        if (recurrence) await api.setRecurrence(id, recurrence);
        if (time) await api.setTime(id, time);
        for (const p of pending) await api.attach(id, p);
        if (tags.length) await api.setTags(id, tags);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(`Não foi possível salvar: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const removeSaved = async (a: Attachment) => {
    await api.detach(a.id);
    if (task) loadAttachments(task.id);
    onSaved();
  };

  const total = saved.length + pending.length;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
        </DialogHeader>
        <motion.form
          variants={formVariants}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <motion.div variants={fieldVariants}>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="O que precisa ser feito?"
              className="h-10 text-base"
            />
          </motion.div>
          <motion.div variants={fieldVariants} className="flex flex-col gap-1.5">
            <Label>Data</Label>
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker value={date} onChange={setDate} />
              <TimeField value={time} onChange={setTime} />
            </div>
          </motion.div>
          <motion.div variants={fieldVariants} className="flex flex-col gap-1.5">
            <Label>Prioridade</Label>
            <PrioritySelect value={priority} onChange={setPriority} />
          </motion.div>
          <motion.div variants={fieldVariants} className="flex flex-col gap-1.5">
            <Label>Repetir</Label>
            <RecurrenceSelect value={recurrence} onChange={setRecurrence} />
          </motion.div>
          <motion.div variants={fieldVariants} className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <TagInput value={tags} onChange={setTags} />
          </motion.div>
          <motion.div variants={fieldVariants} className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notas</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalhes, links, contexto…"
              className="min-h-24"
            />
          </motion.div>
          {task && (
            <motion.div variants={fieldVariants}>
              <SubtasksList parentId={task.id} onChanged={onSaved} />
            </motion.div>
          )}
          <motion.div variants={fieldVariants} className="flex flex-col gap-1.5">
            <Label>Anexos{total > 0 && <span className="text-muted-foreground">({total})</span>}</Label>
            <div
              className={cn(
                "flex flex-col rounded-lg border border-dashed p-3 transition-colors",
                dragging && "border-primary bg-accent",
              )}
            >
              <AnimatePresence initial={false}>
                {total === 0 && (
                  <motion.p key="vazio" {...itemMotion} className="flex items-center gap-2 overflow-hidden pb-2 text-sm text-muted-foreground">
                    <Upload className="size-4" /> Arraste arquivos aqui
                  </motion.p>
                )}
                {saved.map((a) => (
                  <motion.div key={`s${a.id}`} {...itemMotion} className="overflow-hidden">
                    <div className="flex items-center gap-2 pb-2 text-sm">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left hover:underline"
                        onClick={() => api.open(a.path).catch((e) => toast.error(String(e)))}
                      >
                        {a.filename}
                      </button>
                      <span className="text-xs text-muted-foreground">{formatSize(a.size)}</span>
                      <Button type="button" size="icon-xs" variant="ghost" onClick={() => removeSaved(a)} aria-label="Remover anexo">
                        <X />
                      </Button>
                    </div>
                  </motion.div>
                ))}
                {pending.map((p) => (
                  <motion.div key={`p${p}`} {...itemMotion} className="overflow-hidden">
                    <div className="flex items-center gap-2 pb-2 text-sm">
                      <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{baseName(p)}</span>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setPending((cur) => cur.filter((x) => x !== p))}
                        aria-label="Remover anexo"
                      >
                        <X />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <Button type="button" size="sm" variant="outline" className="self-start" onClick={choose}>
                <Plus data-icon="inline-start" /> Adicionar arquivo
              </Button>
            </div>
          </motion.div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <motion.span whileTap={{ scale: 0.96 }} transition={{ duration: DUR_FAST }} className="inline-flex">
              <Button type="submit" disabled={!title.trim() || saving} className="w-full">
                {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {task ? "Salvar" : "Criar"}
              </Button>
            </motion.span>
          </DialogFooter>
        </motion.form>
      </DialogContent>
    </Dialog>
  );
}

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Task } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DUR_BASE, DUR_FAST, easeOut } from "@/lib/motion";

/** Mini barra de progresso "2/5" usada na linha da tarefa. */
export function SubtaskProgress({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={`${done} de ${total} subtarefas`}
    >
      <span className="h-1 w-8 overflow-hidden rounded-full bg-muted">
        <span className="block h-full bg-primary transition-all" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      {done}/{total}
    </span>
  );
}

/** Checklist de subtarefas de uma tarefa já salva. */
export function SubtasksList({ parentId, onChanged }: { parentId: number; onChanged: () => void }) {
  const [items, setItems] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);

  const load = useCallback(
    () => api.subtasks(parentId).then(setItems).catch((e) => toast.error(String(e))),
    [parentId],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      await load();
      onChanged();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const add = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    await run(api.addSubtask(parentId, t));
  };

  const commitEdit = async () => {
    if (!editing) return;
    const { id, text } = editing;
    setEditing(null);
    const t = text.trim();
    const cur = items.find((s) => s.id === id);
    if (t && cur && t !== cur.title) await run(api.renameSubtask(id, t));
  };

  const done = items.filter((s) => s.done).length;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        Subtarefas {items.length > 0 && <span className="text-muted-foreground">({done}/{items.length})</span>}
      </Label>
      <div className="flex flex-col gap-1">
        <AnimatePresence initial={false}>
        {items.map((s) => (
          <motion.div
            key={s.id}
            layout="position"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: { duration: DUR_BASE, ease: easeOut } }}
            exit={{ opacity: 0, height: 0, transition: { duration: DUR_FAST } }}
            className="group flex items-center gap-2 overflow-hidden py-0.5 text-sm"
          >
            <Checkbox
              checked={s.done}
              onCheckedChange={(c) => run(api.setDone(s.id, c === true))}
              aria-label="Concluir subtarefa"
            />
            {editing?.id === s.id ? (
              <Input
                autoFocus
                value={editing.text}
                className="h-7 flex-1"
                onChange={(e) => setEditing({ id: s.id, text: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className={cn("min-w-0 flex-1 truncate text-left transition-colors duration-200", s.done && "text-muted-foreground line-through")}
                onClick={() => setEditing({ id: s.id, text: s.title })}
              >
                {s.title}
              </button>
            )}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => run(api.remove(s.id))}
              aria-label="Excluir subtarefa"
            >
              <X />
            </Button>
          </motion.div>
        ))}
        </AnimatePresence>
        <div className="flex items-center gap-2">
          <Plus className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={draft}
            className="h-7 flex-1"
            placeholder="Adicionar subtarefa (Enter)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // não envia o formulário da tarefa
                add();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

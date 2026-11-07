import { useCallback, useEffect, useRef, useState } from "react";
import { animate, AnimatePresence, motion, Reorder, useReducedMotion } from "motion/react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Inbox, ListChecks, Plus } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { TaskDialog } from "@/components/task-dialog";
import { TrashView } from "@/components/trash-view";
import { useUndo } from "@/hooks/use-undo";
import { SettingsView } from "@/components/settings";
import { TaskRow } from "@/components/task-row";
import { VoiceButton } from "@/components/voice-button";
import { useVoice } from "@/hooks/use-voice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { api, type Counts, type Filter, type Task } from "@/lib/api";
import { DONE_EXIT_DELAY, listVariants, STAGGER_MAX, STAGGER_STEP } from "@/lib/motion";

const TITLES = ["Hoje", "Amanhã", "Todas as tarefas", "Concluídas", "Caixa de entrada"];
const EMPTY = [
  "Nada para hoje. Aproveite.",
  "Nada planejado para amanhã.",
  "Nenhuma tarefa pendente.",
  "Nenhuma tarefa concluída ainda.",
  "Nenhuma tarefa aguardando aprovação.",
];

type DialogState = { open: boolean; task: Task | null };

export default function App() {
  const [filter, setFilter] = useState<Filter>(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState<Counts>({ today: 0, tomorrow: 0, inbox: 0 });
  const [dates, setDates] = useState<[string, string]>(["", ""]);
  const [quick, setQuick] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ open: false, task: null });
  const [view, setView] = useState<"tasks" | "settings" | "trash">("tasks");
  const [shortcut, setShortcut] = useState("CommandOrControl+Shift+Space");

  // Filtro cuja lista está de fato exibida (muda só quando a nova lista chega).
  const [listFilter, setListFilter] = useState<Filter | null>(null);
  const [firstPaint, setFirstPaint] = useState(true);
  // id -> estado de conclusão otimista enquanto a linha aguarda a saída animada.
  const [pending, setPending] = useState<Map<number, boolean>>(new Map());
  const pendingRef = useRef(new Map<number, boolean>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const filterRef = useRef(filter);
  const listFilterRef = useRef<Filter | null>(null);
  const draggingRef = useRef(false);
  const tasksRef = useRef<Task[]>([]);
  const cascadeUntil = useRef(0);
  const reduce = useReducedMotion();
  // Contador do destino congelado enquanto o card voa; bump dispara o pulso na chegada.
  const [hold, setHold] = useState<{ key: "today" | "tomorrow"; value: number } | null>(null);
  const [bump, setBump] = useState<{ target: "today" | "tomorrow" | "all"; n: number } | null>(null);
  const bumpN = useRef(0);

  filterRef.current = filter;
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    if (listFilter !== null) setFirstPaint(false);
  }, [listFilter]);

  const updatePending = useCallback((fn: (m: Map<number, boolean>) => void) => {
    const m = new Map(pendingRef.current);
    fn(m);
    pendingRef.current = m;
    setPending(m);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [list, c, d] = await Promise.all([api.list(filter), api.counts(), api.dates()]);
      if (filterRef.current !== filter) return; // resposta de um filtro já abandonado
      setCounts(c);
      setDates(d);
      if (draggingRef.current) return; // não sobrescreve a ordem durante o arrasto
      if (listFilterRef.current !== filter) {
        listFilterRef.current = filter;
        cascadeUntil.current = performance.now() + 900;
        setListFilter(filter);
      }
      setTasks((prev) => {
        if (!pendingRef.current.size) return list;
        // Mantém linhas "concluindo" até o fim da animação de saída.
        const ids = new Set(list.map((t) => t.id));
        const out = [...list];
        pendingRef.current.forEach((_, id) => {
          if (ids.has(id)) return;
          const i = prev.findIndex((t) => t.id === id);
          if (i >= 0) out.splice(Math.min(i, out.length), 0, prev[i]);
        });
        return out;
      });
    } catch (e) {
      toast.error(String(e));
    }
  }, [filter]);

  // Troca de filtro / unmount: limpa timers e estados otimistas.
  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach(clearTimeout);
      t.clear();
      pendingRef.current = new Map();
      setPending(pendingRef.current);
    };
  }, [filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // O atalho exibido pode ter mudado nas configurações.
  useEffect(() => {
    if (view === "tasks") api.getSettings().then((s) => setShortcut(s.shortcut)).catch(() => {});
  }, [view]);

  const voice = useVoice(refresh);
  const undo = useUndo(refresh);

  // Tarefas criadas por CLI/agentes aparecem ao voltar para a janela.
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  // Tarefas criadas pela janela quick-add (outro webview) chegam por evento.
  useEffect(() => {
    const sub = listen("tasks-changed", () => refresh());
    return () => {
      sub.then((un) => un());
    };
  }, [refresh]);

  const [today, tomorrow] = dates;
  const defaultDate = filter === 0 ? today : filter === 1 ? tomorrow : null;
  const run = (p: Promise<unknown>) => p.then(refresh).catch((e) => toast.error(String(e)));

  const toggle = (t: Task, done: boolean) => {
    const prevTimer = timers.current.get(t.id);
    if (prevTimer) clearTimeout(prevTimer);
    timers.current.delete(t.id);
    updatePending((m) => m.set(t.id, done));
    if (done) undo.push("Tarefa concluída", () => api.setDone(t.id, false));
    // A linha deixa a lista quando a mudança a tira do filtro atual.
    const leaves = filter === 3 ? !done : filter <= 2 && done;
    const p = api.setDone(t.id, done).catch((e) => {
      toast.error(String(e));
      const tm = timers.current.get(t.id);
      if (tm) clearTimeout(tm);
      timers.current.delete(t.id);
      updatePending((m) => m.delete(t.id));
      refresh();
    });
    const finish = async () => {
      await p;
      timers.current.delete(t.id);
      updatePending((m) => m.delete(t.id));
      refresh();
    };
    if (leaves) timers.current.set(t.id, setTimeout(finish, DONE_EXIT_DELAY));
    else finish();
  };

  const remove = (t: Task) =>
    run(api.remove(t.id).then(() => undo.push("Tarefa movida para a lixeira", () => api.restore(t.id))));

  const commitOrder = () => {
    draggingRef.current = false;
    api.reorder(tasksRef.current.map((t) => t.id)).catch((e) => {
      toast.error(String(e));
      refresh();
    });
  };

  const approve = (t: Task, row: HTMLElement | null) => {
    const target: "today" | "tomorrow" | "all" = t.due && t.due === today ? "today" : t.due && t.due === tomorrow ? "tomorrow" : "all";
    const item = document.querySelector<HTMLElement>(`[data-fly-target="${target}"]`);
    const dest = item?.querySelector<HTMLElement>('[data-sidebar="menu-badge"]') ?? item;
    const arrive = () => {
      setHold(null);
      setBump({ target, n: ++bumpN.current });
    };
    if (!row || !dest || !item || item.offsetParent === null) {
      run(api.approve(t.id));
      return;
    }
    const from = row.getBoundingClientRect();
    const to = dest.getBoundingClientRect();
    if (target !== "all") setHold({ key: target, value: counts[target] });
    run(api.approve(t.id)).then(() => {});
    if (reduce) {
      arrive();
      return;
    }
    const ghost = document.createElement("div");
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
      zIndex: "9999",
      pointerEvents: "none",
      transformOrigin: "center",
      borderRadius: "10px",
      background: "var(--background)",
      boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
      overflow: "hidden",
    });
    const clone = row.cloneNode(true) as HTMLElement;
    clone.removeAttribute("style");
    ghost.appendChild(clone);
    document.body.appendChild(ghost);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const scale = Math.max(0.04, Math.min(0.2, 28 / from.width));
    animate(
      ghost,
      { x: [0, dx], y: [0, dy], scale: [1, scale], opacity: [1, 1, 0.6] },
      { duration: 0.55, ease: [0.5, 0, 0.2, 1] },
    ).then(() => {
      ghost.remove();
      arrive();
    });
    // Segurança: libera o contador mesmo se a animação falhar.
    setTimeout(() => setHold(null), 1500);
  };

  const quickAdd = () => {
    const t = quick.trim();
    if (!t) return;
    setQuick("");
    run(api.add(t, "", defaultDate));
  };

  const subtitle =
    filter === 0 && today
      ? format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })
      : filter === 4
        ? "Tarefas criadas por agentes de IA. Aprove para movê-las para sua lista."
        : null;

  return (
    <SidebarProvider className="h-screen">
      <AppSidebar
        filter={filter}
        onFilter={(f) => {
          setFilter(f);
          setView("tasks");
        }}
        counts={hold ? { ...counts, [hold.key]: hold.value } : counts}
        bump={bump}
        settingsActive={view === "settings"}
        onSettings={() => setView("settings")}
        trashActive={view === "trash"}
        onTrash={() => setView("trash")}
      />
      <SidebarInset className="overflow-hidden">
        {view === "settings" ? (
          <SettingsView />
        ) : view === "trash" ? (
          <TrashView onChanged={refresh} />
        ) : (
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-5 px-8 pt-8">
          <header className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{TITLES[filter]}</h1>
              {subtitle && <p className="mt-1 text-sm text-muted-foreground first-letter:uppercase">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2">
              <VoiceButton state={voice.state} shortcut={shortcut} onToggle={voice.toggle} onCancel={voice.cancel} level={voice.level} />
              {filter <= 2 && (
                <Button onClick={() => setDialog({ open: true, task: null })}>
                  <Plus data-icon="inline-start" /> Nova
                </Button>
              )}
            </div>
          </header>

          {filter <= 2 && (
            <Input
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && quickAdd()}
              placeholder="Adicionar tarefa e pressionar Enter…"
              className="h-10"
            />
          )}

          {listFilter !== null && (
            <ListContainer
              key={listFilter}
              reorderable={listFilter <= 2}
              tasks={tasks}
              setTasks={setTasks}
              firstPaint={firstPaint}
              empty={tasks.length === 0}
            >
              {tasks.map((t, i) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  done={pending.get(t.id) ?? t.done}
                  today={today}
                  tomorrow={tomorrow}
                  inbox={filter === 4}
                  reorderable={listFilter <= 2}
                  delay={performance.now() < cascadeUntil.current ? Math.min(i, STAGGER_MAX) * STAGGER_STEP : 0}
                  onOpen={() => setDialog({ open: true, task: t })}
                  onToggle={(done) => toggle(t, done)}
                  onDelete={() => remove(t)}
                  onApprove={(el) => approve(t, el)}
                  onDragStart={() => {
                    draggingRef.current = true;
                  }}
                  onDragEnd={commitOrder}
                />
              ))}
            </ListContainer>
          )}
          {listFilter !== null && tasks.length === 0 && (
            <motion.div
              key={`empty-${listFilter}`}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.2 }}
              className="flex flex-1 flex-col items-center justify-center gap-3 pb-24 text-muted-foreground"
            >
              {listFilter === 4 ? <Inbox className="size-10" /> : <ListChecks className="size-10" />}
              <p className="text-sm">{EMPTY[listFilter]}</p>
            </motion.div>
          )}
        </div>
        )}
      </SidebarInset>

      <TaskDialog
        open={dialog.open}
        task={dialog.task}
        defaultDate={defaultDate}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSaved={refresh}
      />
    </SidebarProvider>
  );
}

/** Lista com entrada em cascata (remonta por filtro) e, nos filtros 0-2, reordenação por arrasto. */
function ListContainer({
  reorderable,
  tasks,
  setTasks,
  firstPaint,
  empty,
  children,
}: {
  reorderable: boolean;
  tasks: Task[];
  setTasks: (t: Task[]) => void;
  firstPaint: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  const className = cn("relative -mx-3 flex flex-col gap-0.5 overflow-y-auto", !empty && "pb-8");
  const presence = (
    <AnimatePresence initial={!firstPaint} mode="popLayout">
      {children}
    </AnimatePresence>
  );
  if (reorderable) {
    return (
      <Reorder.Group
        axis="y"
        values={tasks}
        onReorder={setTasks}
        layoutScroll
        className={className}
        variants={listVariants}
        initial="hidden"
        animate="show"
      >
        {presence}
      </Reorder.Group>
    );
  }
  return (
    <motion.ul layoutScroll className={className} variants={listVariants} initial="hidden" animate="show">
      {presence}
    </motion.ul>
  );
}

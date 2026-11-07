import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, AnimatePresence, motion, Reorder, useAnimationControls, useReducedMotion } from "motion/react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Inbox, ListChecks, Plus, SearchX, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { TaskDialog } from "@/components/task-dialog";
import { OverdueSection } from "@/components/overdue-section";
import { TrashView } from "@/components/trash-view";
import { useUndo } from "@/hooks/use-undo";
import { SettingsView } from "@/components/settings";
import { TaskRow } from "@/components/task-row";
import { SearchBox } from "@/components/search-box";
import { Collapse, SwapText } from "@/components/animated-title";
import { EmptyState } from "@/components/empty-state";
import { ShortcutsHelp } from "@/components/shortcuts-help";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { VoiceButton } from "@/components/voice-button";
import { useVoice } from "@/hooks/use-voice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { api, type Counts, type Filter, type Task, type TagCount } from "@/lib/api";
import { DONE_EXIT_DELAY, DUR_BASE, DUR_FAST, easeOut, listVariants, STAGGER_MAX, STAGGER_STEP } from "@/lib/motion";

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
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [dates, setDates] = useState<[string, string]>(["", ""]);
  const [quick, setQuick] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ open: false, task: null });
  // Filtro por tag (independente de Filter); quando definido, filter fica em 2.
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagList, setTagList] = useState<TagCount[]>([]);
  const activeTagRef = useRef<string | null>(null);
  const [view, setView] = useState<"tasks" | "settings" | "trash">("tasks");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; list: Task[] } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
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
  const quickControls = useAnimationControls();
  const hadFound = useRef(false);
  const lastSubtitle = useRef<string | null>(null);

  filterRef.current = filter;
  activeTagRef.current = activeTag;
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
      const [list, c, d, od, tg] = await Promise.all([
        activeTag ? api.listByTag(activeTag) : api.list(filter),
        api.counts(),
        api.dates(),
        api.overdue(),
        api.tags(),
      ]);
      if (filterRef.current !== filter || activeTagRef.current !== activeTag) return; // resposta de um filtro já abandonado
      setOverdue(od);
      setTagList(tg);
      if (activeTag && !tg.some((x) => x.name.toLowerCase() === activeTag.toLowerCase())) setActiveTag(null);
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
  }, [filter, activeTag]);

  // Troca de filtro / unmount: limpa timers e estados otimistas.
  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach(clearTimeout);
      t.clear();
      pendingRef.current = new Map();
      setPending(pendingRef.current);
    };
  }, [filter, activeTag]);

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
    const leaves = !query.trim() && filter === 3 ? !done : filter <= 2 && done;
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
    if (activeTag) return refresh(); // subconjunto filtrado: não grava a ordem
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

  // Clique numa tag dentro de uma linha: filtra por ela (e limpa a busca).
  const openTag = (name: string) => {
    setQuery("");
    setActiveTag(name);
    setFilter(2);
    setView("tasks");
  };

  const quickAdd = () => {
    const t = quick.trim();
    if (!t) return;
    setQuick("");
    if (!reduce) quickControls.start({ scale: [1, 1.015, 1], transition: { duration: 0.28, ease: easeOut } });
    // Com um filtro de tag ativo, a tarefa nova já nasce com a tag (senão sumiria da tela).
    run(api.add(t, "", defaultDate).then((id) => (activeTag ? api.setTags(id, [activeTag]) : undefined)));
  };

  // Busca: re-executa quando o termo ou a lista mudam (ex.: após concluir/excluir).
  const q = query.trim();
  const searching = q !== "";
  useEffect(() => {
    if (!q) {
      hadFound.current = false;
      setFound(null);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      api
        .search(q)
        .then((list) => {
          if (stale) return;
          // Primeira leva de resultados da busca entra em cascata curta.
          if (!hadFound.current) cascadeUntil.current = performance.now() + 500;
          hadFound.current = true;
          setFound({ q, list });
        })
        .catch((e) => toast.error(String(e)));
    }, 120);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, tasks]);

  const shown = searching ? (found?.list ?? []) : tasks;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // A seleção some ao trocar de filtro/busca ou se a tarefa deixou a lista.
  useEffect(() => {
    setSelectedId(null);
  }, [filter, q, view]);
  useEffect(() => {
    if (selectedId !== null && !shown.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [shown, selectedId]);
  useEffect(() => {
    if (selectedId === null) return;
    document.querySelector(`[data-task-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const selectedTask = () => shownRef.current.find((t) => t.id === selectedIdRef.current) ?? null;
  useShortcuts({
    enabled: view === "tasks",
    onNew: () => (filter <= 2 || searching) && setDialog({ open: true, task: null }),
    onFocusSearch: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    onMove: (d) => {
      const list = shownRef.current;
      if (!list.length) return;
      const i = list.findIndex((t) => t.id === selectedIdRef.current);
      const next = i < 0 ? (d > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + d));
      setSelectedId(list[next].id);
    },
    onToggleSelected: () => {
      const t = selectedTask();
      if (t && filter !== 4) toggle(t, !(pending.get(t.id) ?? t.done));
    },
    onOpenSelected: () => {
      const t = selectedTask();
      if (t) setDialog({ open: true, task: t });
    },
    onDeleteSelected: () => {
      const t = selectedTask();
      if (!t) return;
      const list = shownRef.current;
      const i = list.findIndex((x) => x.id === t.id);
      setSelectedId((list[i + 1] ?? list[i - 1])?.id ?? null);
      run(api.remove(t.id));
    },
    onEscape: () => (searching ? setQuery("") : setSelectedId(null)),
    onHelp: () => setHelpOpen(true),
  });

  const subtitle =
    filter === 0 && today
      ? format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })
      : filter === 4
        ? "Tarefas criadas por agentes de IA. Aprove para movê-las para sua lista."
        : null;
  if (subtitle) lastSubtitle.current = subtitle;

  return (
    <SidebarProvider className="h-screen">
      <AppSidebar
        filter={filter}
        tags={tagList}
        activeTag={activeTag}
        onTag={(name) => {
          // Clicar na tag já ativa desfaz o filtro.
          if (activeTag?.toLowerCase() === name.toLowerCase()) setActiveTag(null);
          else {
            setActiveTag(name);
            setFilter(2);
          }
          setView("tasks");
        }}
        onFilter={(f) => {
          setActiveTag(null);
          setFilter(f);
          setView("tasks");
        }}
        counts={{ ...(hold ? { ...counts, [hold.key]: hold.value } : counts), today: (hold?.key === "today" ? hold.value : counts.today) + overdue.length }}
        bump={bump}
        settingsActive={view === "settings"}
        onSettings={() => setView("settings")}
        trashActive={view === "trash"}
        onTrash={() => setView("trash")}
      />
      <SidebarInset className="overflow-hidden">
        <AnimatePresence mode="wait">
        <motion.div
          key={view}
          className="h-full"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DUR_BASE, ease: easeOut } }}
          exit={{ opacity: 0, y: -4, transition: { duration: DUR_FAST } }}
        >
        {view === "settings" ? (
          <SettingsView />
        ) : view === "trash" ? (
          <TrashView onChanged={refresh} />
        ) : (
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-5 px-8 pt-8">
          <header className="flex items-end justify-between gap-4">
            <div>
              <SwapText id={activeTag ? `#${activeTag}` : filter} className="text-2xl font-semibold tracking-tight">
                {activeTag ? `#${activeTag}` : TITLES[filter]}
              </SwapText>
              <Collapse show={!!subtitle}>
                <SwapText id={subtitle ?? lastSubtitle.current ?? ""} as="p" className="mt-1 text-sm text-muted-foreground first-letter:uppercase">
                  {subtitle ?? lastSubtitle.current}
                </SwapText>
              </Collapse>
              <Collapse show={!!activeTag}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setActiveTag(null)}
                  className="mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  Filtrando por #{activeTag} <X className="size-3" />
                </motion.button>
              </Collapse>
            </div>
            <div className="flex items-center gap-2">
              <SearchBox value={query} onChange={setQuery} inputRef={searchRef} />
              <VoiceButton state={voice.state} shortcut={shortcut} onToggle={voice.toggle} onCancel={voice.cancel} level={voice.level} />
              {filter <= 2 && (
                <motion.div whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.03 }} transition={{ duration: DUR_FAST }}>
                  <Button onClick={() => setDialog({ open: true, task: null })}>
                    <Plus data-icon="inline-start" /> Nova
                  </Button>
                </motion.div>
              )}
            </div>
          </header>

          {filter <= 2 && (
            <motion.div animate={quickControls}>
              <Input
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && quickAdd()}
                placeholder="Adicionar tarefa e pressionar Enter…"
                className="h-10 transition-shadow focus-visible:shadow-md"
              />
            </motion.div>
          )}

          {listFilter === 0 && !searching && (
            <OverdueSection tasks={overdue} onRescheduleAll={() => run(api.rescheduleToToday())}>
              {overdue.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onTagClick={openTag}
                  done={pending.get(t.id) ?? t.done}
                  today={today}
                  tomorrow={tomorrow}
                  inbox={false}
                  reorderable={false}
                  delay={0}
                  onOpen={() => setDialog({ open: true, task: t })}
                  onToggle={(done) => toggle(t, done)}
                  onDelete={() => run(api.remove(t.id))}
                  onApprove={() => {}}
                  extra={
                    <Button size="xs" variant="outline" onClick={() => run(api.rescheduleToToday(t.id))}>
                      Reagendar para hoje
                    </Button>
                  }
                />
              ))}
            </OverdueSection>
          )}
          {listFilter !== null && !(searching && found?.list.length === 0) && (
            <ListContainer
              key={searching ? "search" : listFilter}
              reorderable={!searching && listFilter <= 2 && !activeTag}
              tasks={shown}
              setTasks={setTasks}
              firstPaint={firstPaint}
              empty={shown.length === 0}
            >
              {shown.map((t, i) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onTagClick={openTag}
                  done={pending.get(t.id) ?? t.done}
                  today={today}
                  tomorrow={tomorrow}
                  inbox={!searching && filter === 4}
                  reorderable={!searching && listFilter <= 2 && !activeTag}
                  selected={t.id === selectedId}
                  highlight={searching ? q : undefined}
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
          {searching && found?.q === q && found.list.length === 0 && (
            <EmptyState
              key="busca-vazia"
              icon={SearchX}
              title={`Nada encontrado para “${q}”.`}
              hint="Tente outras palavras. A busca olha título e notas."
            />
          )}
          {!searching && listFilter !== null && tasks.length === 0 && (
            <EmptyState
              key={`empty-${listFilter}`}
              icon={listFilter === 4 ? Inbox : ListChecks}
              title={EMPTY[listFilter]}
            />
          )}
        </div>
        )}
        </motion.div>
        </AnimatePresence>
      </SidebarInset>

      <TaskDialog
        open={dialog.open}
        task={dialog.task}
        defaultDate={defaultDate}
        defaultTags={activeTag ? [activeTag] : undefined}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSaved={refresh}
      />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
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
  // Ao sair uma linha, as de baixo sobem animando a partir da posição antiga e, por um instante,
  // passam do fim do contêiner: a barra de rolagem piscava. Travamos o eixo vertical só durante
  // o deslize. O eixo horizontal fica sempre cortado (a linha que sai desliza para a direita).
  const count = Children.count(children);
  const prevCount = useRef(count);
  const [settling, setSettling] = useState(false);
  // useLayoutEffect: roda antes da pintura. Com useEffect o primeiro quadro (justo o da barra) escapava.
  useLayoutEffect(() => {
    const shrank = count < prevCount.current;
    prevCount.current = count;
    if (!shrank) return;
    setSettling(true);
    const t = setTimeout(() => setSettling(false), 900);
    return () => clearTimeout(t);
  }, [count]);
  const className = cn(
    "relative -mx-3 flex flex-col gap-0.5 overflow-x-hidden",
    settling ? "overflow-y-hidden" : "overflow-y-auto",
    !empty && "pb-8",
  );
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

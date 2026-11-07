import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Inbox, ListChecks, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { TaskDialog } from "@/components/task-dialog";
import { SettingsView } from "@/components/settings";
import { TaskRow } from "@/components/task-row";
import { VoiceButton } from "@/components/voice-button";
import { useVoice } from "@/hooks/use-voice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { api, type Counts, type Filter, type Task } from "@/lib/api";

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
  const [view, setView] = useState<"tasks" | "settings">("tasks");
  const [shortcut, setShortcut] = useState("CommandOrControl+Shift+Space");

  const refresh = useCallback(async () => {
    try {
      const [list, c, d] = await Promise.all([api.list(filter), api.counts(), api.dates()]);
      setTasks(list);
      setCounts(c);
      setDates(d);
    } catch (e) {
      toast.error(String(e));
    }
  }, [filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // O atalho exibido pode ter mudado nas configurações.
  useEffect(() => {
    if (view === "tasks") api.getSettings().then((s) => setShortcut(s.shortcut)).catch(() => {});
  }, [view]);

  const voice = useVoice(refresh);

  // Tarefas criadas por CLI/agentes aparecem ao voltar para a janela.
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const [today, tomorrow] = dates;
  const defaultDate = filter === 0 ? today : filter === 1 ? tomorrow : null;
  const run = (p: Promise<unknown>) => p.then(refresh).catch((e) => toast.error(String(e)));

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
        counts={counts}
        settingsActive={view === "settings"}
        onSettings={() => setView("settings")}
      />
      <SidebarInset className="overflow-hidden">
        {view === "settings" ? (
          <SettingsView />
        ) : (
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-5 px-8 pt-8">
          <header className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{TITLES[filter]}</h1>
              {subtitle && <p className="mt-1 text-sm text-muted-foreground first-letter:uppercase">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2">
              <VoiceButton state={voice.state} shortcut={shortcut} onToggle={voice.toggle} onCancel={voice.cancel} />
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

          {tasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-24 text-muted-foreground">
              {filter === 4 ? <Inbox className="size-10" /> : <ListChecks className="size-10" />}
              <p className="text-sm">{EMPTY[filter]}</p>
            </div>
          ) : (
            <ul className="-mx-3 flex flex-col gap-0.5 overflow-y-auto pb-8">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  today={today}
                  tomorrow={tomorrow}
                  inbox={filter === 4}
                  onOpen={() => setDialog({ open: true, task: t })}
                  onToggle={(done) => run(api.setDone(t.id, done))}
                  onDelete={() => run(api.remove(t.id))}
                  onApprove={() => run(api.approve(t.id))}
                />
              ))}
            </ul>
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

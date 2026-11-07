import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { AlertCircle, CheckCircle2, FlaskConical, FolderOpen, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DUR_BASE, DUR_FAST, easeOut, fadeUp, softSpring } from "@/lib/motion";
import {
  acceleratorFromEvent,
  api,
  prettyShortcut,
  type ClaudeStatus,
  type ClaudeTest,
  type Discovery,
  type Settings,
} from "@/lib/api";

const MODELS = [
  { value: "haiku", label: "Haiku (recomendado)" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
];
const EFFORTS = [
  { value: "low", label: "Baixo (recomendado)" },
  { value: "medium", label: "Médio" },
  { value: "high", label: "Alto" },
  { value: "xhigh", label: "Muito alto" },
  { value: "max", label: "Máximo" },
];
const THEMES = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];
const AUTO = "__auto__";
const CUSTOM = "__custom__";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <motion.section variants={fadeUp} className="flex flex-col gap-4 rounded-xl border p-5">
      <div>
        <h2 className="font-medium">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </motion.section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SettingsView() {
  const { theme = "system", setTheme } = useTheme();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: true; r: ClaudeTest } | { ok: false; e: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [capturingQuick, setCapturingQuick] = useState(false);

  const detect = useCallback((path: string | null) => api.detectClaude(path).then(setClaude).catch(() => {}), []);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSaved(s);
        setForm(s);
        detect(s.claudePath);
      })
      .catch((e) => toast.error(String(e)));
    api.models().then(setDiscovery).catch(() => {});
  }, [detect]);

  if (!form || !saved) return null;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const patch = (p: Partial<Settings>) => setForm({ ...form, ...p });

  const save = async () => {
    try {
      const s = await api.saveSettings(form);
      setSaved(s);
      setForm(s);
      detect(s.claudePath);
      toast.success("Configurações salvas");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest({ ok: true, r: await api.testClaude(form) });
    } catch (e) {
      setTest({ ok: false, e: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const models = discovery?.models ?? [];
  const unsupported = models.filter((m) => !m.supported);
  const modelItems = [
    { value: AUTO, label: "Automático (recomendado)", disabled: false },
    ...models.map((m) => ({
      value: m.path,
      label: `${m.id} · ${m.sizeMb} MB${m.selectedInHandy ? " · em uso no Handy" : ""}${m.supported ? "" : " · indisponível"}`,
      disabled: !m.supported,
    })),
  ];
  const customModel = !MODELS.some((m) => m.value === form.claudeModel);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-8 pt-8 pb-4">
        <h1 className="mx-auto w-full max-w-2xl text-2xl font-semibold tracking-tight">Configurações</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <motion.div
          className="mx-auto flex w-full max-w-2xl flex-col gap-5"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } }}
        >
          <Section title="Voz" hint="Grave, transcreva localmente e crie a tarefa. O áudio não sai do seu computador.">
            <Field
              label="Modelo de transcrição"
              hint={
                !discovery
                  ? "Procurando modelos…"
                  : models.length === 0
                    ? "Nenhum modelo encontrado. Instale o Handy e baixe um modelo. Veja abaixo onde procurei."
                    : "Modelos do Handy são usados somente para leitura."
              }
            >
              <Select
                items={modelItems}
                value={form.sttModelDir ?? AUTO}
                onValueChange={(v) => patch({ sttModelDir: v === AUTO ? null : (v as string) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelItems.map((i) => (
                    <SelectItem key={i.value} value={i.value} disabled={i.disabled}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {unsupported.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="mt-px size-3.5 shrink-0" />
                  <span>
                    {unsupported.length} modelo{unsupported.length > 1 ? "s" : ""} do Handy não funciona
                    {unsupported.length > 1 ? "m" : ""} neste build do Prumo: {unsupported[0].reason}.
                  </span>
                </p>
              )}
              {discovery && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Onde procurei modelos</summary>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {discovery.searched.map((s) => (
                      <li key={s.path} className="flex items-start gap-1.5 break-all">
                        <span className={s.exists ? "text-green-600" : "text-destructive"}>{s.exists ? "✓" : "✗"}</span>
                        <span>
                          {s.path}
                          {!s.exists && " (não existe)"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Field>
            <Field label="Atalho global" hint="Clique e pressione a combinação (com Ctrl, ⌘, Alt ou Shift). Vale mesmo com o app em segundo plano.">
              <Input
                readOnly
                value={capturing ? "Pressione o atalho…" : prettyShortcut(form.shortcut)}
                onFocus={() => setCapturing(true)}
                onBlur={() => setCapturing(false)}
                onKeyDown={(e) => {
                  e.preventDefault();
                  const a = acceleratorFromEvent(e);
                  if (a) {
                    patch({ shortcut: a });
                    e.currentTarget.blur();
                  }
                }}
                className="max-w-48 cursor-pointer"
              />
            </Field>
            <Field label="Atalho da tarefa rápida" hint="Abre uma janelinha para digitar ou ditar uma tarefa de qualquer app. Precisa ser diferente do atalho de voz.">
              <Input
                readOnly
                value={capturingQuick ? "Pressione o atalho…" : prettyShortcut(form.quickAddShortcut)}
                onFocus={() => setCapturingQuick(true)}
                onBlur={() => setCapturingQuick(false)}
                onKeyDown={(e) => {
                  e.preventDefault();
                  const a = acceleratorFromEvent(e);
                  if (a) {
                    patch({ quickAddShortcut: a });
                    e.currentTarget.blur();
                  }
                }}
                className="max-w-48 cursor-pointer"
              />
            </Field>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="auto">Adicionar direto à lista</Label>
                <p className="text-xs text-muted-foreground">
                  Desligado: tarefas por voz vão para a caixa de entrada, para você conferir a transcrição.
                </p>
              </div>
              <Switch id="auto" checked={form.autoApprove} onCheckedChange={(c) => patch({ autoApprove: c })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="reminders">Lembretes com notificação</Label>
                <p className="text-xs text-muted-foreground">
                  Avisa no horário das tarefas que têm hora definida.
                </p>
              </div>
              <Switch id="reminders" checked={form.reminders} onCheckedChange={(c) => patch({ reminders: c })} />
            </div>
          </Section>

          <Section title="Claude" hint="Interpreta o que você disse (título e data) usando a CLI do Claude Code, com a sua assinatura.">
            <div className="flex items-start gap-2 text-sm">
              {claude?.version ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0">
                <p>{claude?.version ? `Claude Code ${claude.version}` : (claude?.error ?? "Procurando…")}</p>
                {claude?.path && <p className="truncate text-xs text-muted-foreground">{claude.path}</p>}
              </div>
            </div>
            <Field label="Caminho da CLI (opcional)" hint="Deixe vazio para detectar automaticamente.">
              <Input
                value={form.claudePath ?? ""}
                onChange={(e) => patch({ claudePath: e.target.value || null })}
                placeholder="/Users/você/.local/bin/claude"
              />
            </Field>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
              <Field label="Modelo">
                <Select
                  items={[...MODELS, ...(customModel ? [{ value: form.claudeModel, label: form.claudeModel }] : []), { value: CUSTOM, label: "Outro…" }]}
                  value={form.claudeModel}
                  onValueChange={(v) => patch({ claudeModel: v === CUSTOM ? "" : (v as string) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                    {customModel && form.claudeModel && <SelectItem value={form.claudeModel}>{form.claudeModel}</SelectItem>}
                    <SelectItem value={CUSTOM}>Outro…</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Esforço">
                <Select items={EFFORTS} value={form.claudeEffort} onValueChange={(v) => patch({ claudeEffort: v as string })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EFFORTS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {(customModel || form.claudeModel === "") && (
              <Field label="Nome do modelo" hint="Alias (sonnet) ou id completo, como claude-sonnet-5-5.">
                <Input value={form.claudeModel} onChange={(e) => patch({ claudeModel: e.target.value })} placeholder="claude-haiku-5-5" />
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={runTest} disabled={testing}>
                {testing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FlaskConical data-icon="inline-start" />}
                Testar interpretação
              </Button>
              {!test && !testing && (
                <p className="text-xs text-muted-foreground">Usa a frase “ligar para o João amanhã de manhã”.</p>
              )}
              <AnimatePresence mode="wait" initial={false}>
                {test?.ok && (
                  <motion.p
                    key="ok"
                    className="text-sm text-muted-foreground"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0, transition: { duration: DUR_BASE, ease: easeOut } }}
                    exit={{ opacity: 0, transition: { duration: DUR_FAST } }}
                  >
                    {test.r.title} · {test.r.date ?? "sem data"} · {(test.r.ms / 1000).toFixed(1)} s
                  </motion.p>
                )}
                {test && !test.ok && (
                  <motion.p
                    key="erro"
                    className="text-sm text-destructive"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0, transition: { duration: DUR_BASE, ease: easeOut } }}
                    exit={{ opacity: 0, transition: { duration: DUR_FAST } }}
                  >
                    {test.e}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </Section>

          <Section title="Diagnóstico" hint="O Prumo grava um arquivo de log (prumo.log) com cada etapa da voz. Se o app fechar sozinho, a última linha mostra onde parou.">
            <div>
              <Button
                variant="outline"
                onClick={() => api.openLogs().catch((e) => toast.error(String(e)))}
              >
                <FolderOpen data-icon="inline-start" />
                Abrir pasta de logs
              </Button>
            </div>
          </Section>

          <Section title="Aparência">
            <div role="group" aria-label="Tema" className="inline-flex gap-1 self-start rounded-lg border bg-muted/50 p-1">
              {THEMES.map((t) => {
                const active = theme === t.value;
                return (
                  <motion.button
                    key={t.value}
                    type="button"
                    aria-pressed={active}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setTheme(t.value)}
                    className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {active && (
                      <motion.span layoutId="tema-ativo" transition={softSpring} className="absolute inset-0 rounded-md bg-primary" />
                    )}
                    <span className="relative">{t.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </Section>
        </motion.div>
      </div>
      <footer className="border-t bg-background px-8 py-3">
        <div className="mx-auto flex w-full max-w-2xl justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setForm(saved)}>
            Descartar
          </Button>
          <Button disabled={!dirty || !form.claudeModel.trim()} onClick={save}>
            Salvar alterações
          </Button>
        </div>
      </footer>
    </div>
  );
}

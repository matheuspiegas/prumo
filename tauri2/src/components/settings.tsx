import { useCallback, useEffect, useState } from "react";
import { centerOf, useThemeTransition } from "@/hooks/use-theme-transition";
import { AlertCircle, CheckCircle2, FlaskConical, Copy, FolderOpen, Loader2 } from "lucide-react";
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
  type Agent,
  type AgentStatus,
  type AgentTest,
  type CodexModel,
  type McpCommands,
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
const AGENTS: { value: Agent; label: string; hint: string }[] = [
  { value: "claude", label: "Claude Code", hint: "Usa a CLI `claude` com a sua assinatura da Anthropic." },
  { value: "codex", label: "Codex", hint: "Usa a CLI `codex` com a sua conta da OpenAI." },
];
const AUTO = "__auto__";
const CODEX_DEFAULT = "__codex_default__";
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

function CommandRow({ label, cmd }: { label: string; cmd: string }) {
  return (
    <Field label={label} hint="Rode este comando uma vez no terminal. Se mover o app de pasta, rode de novo.">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">{cmd}</code>
        <Button
          variant="outline"
          size="icon"
          aria-label="Copiar comando"
          disabled={!cmd}
          onClick={() => navigator.clipboard.writeText(cmd).then(() => toast.success("Comando copiado"))}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </Field>
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
  const { theme, change: changeTheme } = useThemeTransition();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [mcpCmd, setMcpCmd] = useState<McpCommands | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [codexModels, setCodexModels] = useState<CodexModel[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: true; r: AgentTest } | { ok: false; e: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [capturingQuick, setCapturingQuick] = useState(false);

  useEffect(() => {
    api.mcpCommand().then(setMcpCmd).catch(() => {});
  }, []);

  const detect = useCallback((agent: Agent, path: string | null) => {
    setStatus(null);
    api.detectAgent(agent, path).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSaved(s);
        setForm(s);
      })
      .catch((e) => toast.error(String(e)));
    api.models().then(setDiscovery).catch(() => {});
  }, []);

  // Revalida a CLI ao trocar de agente ou depois de salvar um caminho novo.
  const agent = form?.agent;
  const savedPath = saved ? (agent === "codex" ? saved.codexPath : saved.claudePath) : null;
  useEffect(() => {
    if (!agent) return;
    detect(agent, savedPath);
    setTest(null);
  }, [agent, savedPath, detect]);

  // Catálogo de modelos do Codex (só quando o Codex está escolhido).
  const codexPath = saved?.codexPath ?? null;
  useEffect(() => {
    if (agent !== "codex") return;
    api.codexModels(codexPath).then(setCodexModels).catch(() => setCodexModels([]));
  }, [agent, codexPath]);

  if (!form || !saved) return null;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const patch = (p: Partial<Settings>) => setForm({ ...form, ...p });

  const save = async () => {
    try {
      const s = await api.saveSettings(form);
      setSaved(s);
      setForm(s);
      toast.success("Configurações salvas");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest({ ok: true, r: await api.testAgent(form) });
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
  const isCodex = form.agent === "codex";
  const agentInfo = AGENTS.find((a) => a.value === form.agent) ?? AGENTS[0];
  const inCatalog = (slug: string) => !!codexModels?.some((m) => m.slug === slug);
  // "Outro…" guarda um espaço até o usuário digitar (vazio significa "padrão do Codex").
  const codexCustom = form.codexModel !== "" && !inCatalog(form.codexModel);
  const codexItems = [
    { value: CODEX_DEFAULT, label: "Padrão do Codex" },
    ...(codexModels ?? []).map((m) => ({ value: m.slug, label: m.name })),
    ...(codexCustom && form.codexModel.trim() ? [{ value: form.codexModel, label: form.codexModel.trim() }] : []),
    { value: CUSTOM, label: "Outro…" },
  ];
  const codexSelectValue = form.codexModel === "" ? CODEX_DEFAULT : codexCustom && !form.codexModel.trim() ? CUSTOM : form.codexModel;
  const codexDescription = codexModels?.find((m) => m.slug === form.codexModel)?.description;

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
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    api
                      .testReminder()
                      .then(() => toast.success("Notificação enviada"))
                      .catch((e) => toast.error(`Falhou: ${e}`))
                  }
                >
                  Testar
                </Button>
                <Switch id="reminders" checked={form.reminders} onCheckedChange={(c) => patch({ reminders: c })} />
              </div>
            </div>
          </Section>

          <Section title="Inicialização" hint="Os lembretes só disparam com o Prumo aberto (fechar a janela o mantém na bandeja).">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="launch">Abrir com o sistema</Label>
                <p className="text-xs text-muted-foreground">Inicia o Prumo quando você entra no computador.</p>
              </div>
              <Switch id="launch" checked={form.launchAtLogin} onCheckedChange={(c) => patch({ launchAtLogin: c })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="minimized">Iniciar minimizado</Label>
                <p className="text-xs text-muted-foreground">Ao abrir com o sistema, fica só na bandeja, sem mostrar a janela.</p>
              </div>
              <Switch
                id="minimized"
                disabled={!form.launchAtLogin}
                checked={form.startMinimized}
                onCheckedChange={(c) => patch({ startMinimized: c })}
              />
            </div>
          </Section>

          <Section
            title="Agentes (MCP e CLI)"
            hint="Deixe o Claude Code ou o Codex criarem tarefas. Tudo que eles criam cai na caixa de entrada para você aprovar."
          >
            <CommandRow label="Registrar no Claude Code" cmd={mcpCmd?.claude ?? ""} />
            <CommandRow label="Registrar no Codex" cmd={mcpCmd?.codex ?? ""} />
          </Section>

          <Section
            title="Interpretação"
            hint="Transforma o que você fala ou digita na tarefa rápida em tarefas, com data e horário. Uma frase pode virar várias tarefas."
          >
            <div role="radiogroup" aria-label="Agente" className="inline-flex gap-1 self-start rounded-lg border bg-muted/50 p-1">
              {AGENTS.map((a) => {
                const active = form.agent === a.value;
                return (
                  <motion.button
                    key={a.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => patch({ agent: a.value })}
                    className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {active && (
                      <motion.span layoutId="agente-ativo" transition={softSpring} className="absolute inset-0 rounded-md bg-primary" />
                    )}
                    <span className="relative">{a.label}</span>
                  </motion.button>
                );
              })}
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{agentInfo.hint}</p>
            <div className="flex items-start gap-2 text-sm">
              {status?.version ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
              ) : status ? (
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p>{status?.version ? `${agentInfo.label} ${status.version}` : (status?.error ?? "Procurando…")}</p>
                {status?.path && <p className="truncate text-xs text-muted-foreground">{status.path}</p>}
              </div>
            </div>
            <Field label="Caminho da CLI (opcional)" hint="Deixe vazio para detectar automaticamente.">
              {isCodex ? (
                <Input
                  value={form.codexPath ?? ""}
                  onChange={(e) => patch({ codexPath: e.target.value || null })}
                  placeholder="C:\Users\você\AppData\Roaming\npm\codex.cmd"
                />
              ) : (
                <Input
                  value={form.claudePath ?? ""}
                  onChange={(e) => patch({ claudePath: e.target.value || null })}
                  placeholder="/Users/você/.local/bin/claude"
                />
              )}
            </Field>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
              {isCodex ? (
                <Field label="Modelo" hint={codexModels === null ? "Lendo os modelos do Codex…" : codexDescription}>
                  <Select
                    items={codexItems}
                    value={codexSelectValue}
                    onValueChange={(v) =>
                      patch({ codexModel: v === CODEX_DEFAULT ? "" : v === CUSTOM ? " " : (v as string) })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {codexItems.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
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
              )}
              <Field label="Esforço">
                <Select
                  items={EFFORTS}
                  value={isCodex ? form.codexEffort : form.claudeEffort}
                  onValueChange={(v) => patch(isCodex ? { codexEffort: v as string } : { claudeEffort: v as string })}
                >
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
            {!isCodex && (customModel || form.claudeModel === "") && (
              <Field label="Nome do modelo" hint="Alias (sonnet) ou id completo, como claude-sonnet-5-5.">
                <Input value={form.claudeModel} onChange={(e) => patch({ claudeModel: e.target.value })} placeholder="claude-haiku-5-5" />
              </Field>
            )}
            {isCodex && codexCustom && (
              <Field label="Nome do modelo" hint="Slug do modelo da OpenAI, como aparece em `codex debug models`.">
                <Input
                  value={form.codexModel.trim()}
                  onChange={(e) => patch({ codexModel: e.target.value.trim() || " " })}
                  placeholder="gpt-6.1-sol"
                />
              </Field>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={runTest} disabled={testing}>
                  {testing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FlaskConical data-icon="inline-start" />}
                  Testar interpretação
                </Button>
                {!test && !testing && (
                  <p className="text-xs text-muted-foreground">
                    Usa “amanhã dentista às 16 e mercado às 18, depois de amanhã viajar a Porto Alegre”.
                  </p>
                )}
                {test?.ok && <p className="text-xs text-muted-foreground">{(test.r.ms / 1000).toFixed(1)} s</p>}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {test?.ok && (
                  <motion.ul
                    key="ok"
                    className="flex flex-col gap-1 text-sm text-muted-foreground"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0, transition: { duration: DUR_BASE, ease: easeOut } }}
                    exit={{ opacity: 0, transition: { duration: DUR_FAST } }}
                  >
                    {test.r.tasks.map((t, i) => (
                      <li key={i}>
                        <span className="text-foreground">{t.title}</span> · {t.date ?? "sem data"}
                        {t.time ? ` · ${t.time}` : ""}
                      </li>
                    ))}
                  </motion.ul>
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
                    onClick={(e) => changeTheme(t.value, centerOf(e.currentTarget))}
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
          <Button disabled={!dirty || (!isCodex && !form.claudeModel.trim()) || (isCodex && codexCustom && !form.codexModel.trim())} onClick={save}>
            Salvar alterações
          </Button>
        </div>
      </footer>
    </div>
  );
}

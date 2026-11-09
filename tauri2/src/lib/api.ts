import { invoke } from "@tauri-apps/api/core";
import { format, isValid, parse } from "date-fns";
import { ptBR } from "date-fns/locale";

export type Task = {
  id: number;
  title: string;
  notes: string;
  due: string | null;
  done: boolean;
  source: string;
  status: string;
  /** 0 nenhuma, 1 baixa, 2 média, 3 alta */
  priority: number;
  /** "HH:MM" */
  dueTime: string | null;
  /** "<unidade>:<n>", unidade day|week|month (ex.: "week:2") */
  recurrence: string | null;
  parentId: number | null;
  deletedAt: string | null;
  subtasksDone: number;
  subtasksTotal: number;
  tags: string[];
};
export type Attachment = { id: number; filename: string; path: string; size: number };
/** Tipo MIME de imagens que o app sabe mostrar (pela extensão); `null` nos demais arquivos. */
export function imageMime(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return (
    { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as Record<string, string>
  )[ext ?? ""] ?? null;
}

export type TagCount = { name: string; count: number };
export type Counts = { today: number; tomorrow: number; inbox: number };

export type Settings = {
  sttModelDir: string | null;
  claudeModel: string;
  claudeEffort: string;
  claudePath: string | null;
  autoApprove: boolean;
  shortcut: string;
  quickAddShortcut: string;
  reminders: boolean;
};
export type ModelInfo = {
  id: string;
  /** Pasta (Parakeet ONNX) ou arquivo (.bin/.gguf). */
  path: string;
  engine: "parakeet-onnx" | "ggml";
  sizeMb: number;
  source: "handy" | "handy-hf" | "prumo";
  selectedInHandy: boolean;
  /** Este build do Prumo consegue usar o modelo? */
  supported: boolean;
  reason: string | null;
};
export type Discovery = {
  models: ModelInfo[];
  /** Onde procuramos modelos (ajuda a diagnosticar lista vazia). */
  searched: { path: string; exists: boolean }[];
};
export type ClaudeStatus = { path: string | null; version: string | null; error: string | null };
export type ClaudeTest = { title: string; date: string | null; notes: string; ms: number };
export type VoiceResult = {
  transcript: string;
  title: string;
  date: string | null;
  fallback: boolean;
  warning: string | null;
  taskId: number;
  inbox: boolean;
};

export type TrashItem = { task: Task; daysAgo: number; daysLeft: number };

/** Visão Semana: atrasadas + um item por dia + sem data (ver docs/plano-semana.md). */
export type DayData = { date: string; tasks: Task[] };
export type WeekData = { overdue: Task[]; days: DayData[]; undated: Task[] };

/** 0 Hoje, 1 Amanhã, 2 Todas, 3 Concluídas, 4 Caixa de entrada */
export type Filter = 0 | 1 | 2 | 3 | 4;

export const api = {
  list: (filter: Filter) => invoke<Task[]>("list_tasks", { filter }),
  counts: () => invoke<Counts>("counts"),
  dates: () => invoke<[string, string]>("dates"),
  /** `from` = YYYY-MM-DD do primeiro dia; `days` = quantos dias (7). */
  week: (from: string, days: number) => invoke<WeekData>("list_week", { from, days }),
  /** `date` null = sem data; `index` = posição entre as pendentes da coluna destino (sem a própria tarefa). */
  moveTask: (id: number, date: string | null, index: number) => invoke<void>("move_task", { id, date, index }),
  add: (title: string, notes: string, date: string | null) =>
    invoke<number>("add_task", { title, notes, date }),
  update: (id: number, title: string, notes: string, date: string | null) =>
    invoke<void>("update_task", { id, title, notes, date }),
  setDone: (id: number, done: boolean) => invoke<void>("set_done", { id, done }),
  setRecurrence: (id: number, recurrence: string | null) => invoke<void>("set_recurrence", { id, recurrence }),
  approve: (id: number) => invoke<void>("approve_task", { id }),
  remove: (id: number) => invoke<void>("delete_task", { id }),
  listTrash: () => invoke<TrashItem[]>("list_trash"),
  restore: (id: number) => invoke<void>("restore_task", { id }),
  purge: (id: number) => invoke<void>("purge_task", { id }),
  emptyTrash: () => invoke<number>("empty_trash"),
  attachments: (taskId: number) => invoke<Attachment[]>("list_attachments", { taskId }),
  attach: (taskId: number, path: string) => invoke<number>("add_attachment", { taskId, path }),
  /** Grava uma imagem colada (bytes crus, sem base64) como anexo da tarefa. */
  attachBytes: (taskId: number, filename: string, bytes: ArrayBuffer) =>
    invoke<number>("add_attachment_bytes", bytes, {
      headers: { "x-task-id": String(taskId), "x-filename": filename },
    }),
  /** Bytes de um anexo (para miniaturas). */
  readAttachment: (id: number) => invoke<ArrayBuffer>("read_attachment", { id }),
  detach: (id: number) => invoke<void>("delete_attachment", { id }),
  open: (path: string) => invoke<void>("open_attachment", { path }),
  tags: () => invoke<TagCount[]>("list_tags"),
  setTags: (taskId: number, tags: string[]) => invoke<void>("set_task_tags", { taskId, tags }),
  listByTag: (name: string) => invoke<Task[]>("list_tasks_by_tag", { name }),
  search: (query: string) => invoke<Task[]>("search_tasks", { query }),
  reorder: (ids: number[]) => invoke<void>("reorder_tasks", { ids }),
  overdue: () => invoke<Task[]>("list_overdue"),
  /** Sem `id`, reagenda todas as atrasadas para hoje. */
  rescheduleToToday: (id?: number) => invoke<void>("reschedule_to_today", { id: id ?? null }),
  setPriority: (id: number, priority: number) => invoke<void>("set_priority", { id, priority }),
  addSubtask: (parentId: number, title: string) => invoke<number>("add_subtask", { parentId, title }),
  subtasks: (parentId: number) => invoke<Task[]>("list_subtasks", { parentId }),
  renameSubtask: (id: number, title: string) => invoke<void>("rename_subtask", { id, title }),
  reorderSubtasks: (parentId: number, ids: number[]) => invoke<void>("reorder_subtasks", { parentId, ids }),
  quickAdd: (title: string, date: string | null, time: string | null = null) =>
    invoke<number>("quick_add_task", { title, date, time }),
  setTime: (id: number, time: string | null) => invoke<void>("set_task_time", { id, time }),
  openLogs: () => invoke<string>("open_logs"),
  voiceStart: () => invoke<void>("voice_start"),
  voiceStop: () => invoke<VoiceResult>("voice_stop"),
  voiceCancel: () => invoke<void>("voice_cancel"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  models: () => invoke<Discovery>("discover_models"),
  detectClaude: (path: string | null) => invoke<ClaudeStatus>("detect_claude", { path }),
  mcpCommand: () => invoke<string>("mcp_command"),
  testClaude: (settings: Settings) => invoke<ClaudeTest>("test_claude", { settings }),
};

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/** "CommandOrControl+Shift+Space" → "⌘⇧Espaço" (ou "Ctrl+Shift+Espaço"). */
export function prettyShortcut(accel: string) {
  const map: Record<string, string> = isMac
    ? { CommandOrControl: "⌘", Command: "⌘", Control: "⌃", Ctrl: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧", Space: "Espaço" }
    : { CommandOrControl: "Ctrl", Command: "Win", Control: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Option: "Alt", Shift: "Shift", Space: "Espaço" };
  const parts = accel.split("+").map((p) => map[p] ?? p);
  return isMac ? parts.join("") : parts.join("+");
}

/** Converte um KeyboardEvent em acelerador do Tauri; `null` se ainda não é um atalho válido. */
export function acceleratorFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const c = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c;
  else if (["Space", "Enter", "Tab", "Backspace"].includes(c)) key = c;
  else if (/^Arrow(Up|Down|Left|Right)$/.test(c)) key = c.slice(5);
  if (!key) return null;
  const mods: string[] = [];
  if (e.metaKey) mods.push(isMac ? "CommandOrControl" : "Super");
  if (e.ctrlKey) mods.push(isMac ? "Control" : "CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  // Exige modificador, para não roubar teclas comuns do sistema inteiro.
  return mods.length ? [...mods, key].join("+") : null;
}

export const ISO = "yyyy-MM-dd";
export const toIso = (d: Date) => format(d, ISO);
export const fromIso = (s: string) => {
  const d = parse(s, ISO, new Date());
  return isValid(d) ? d : undefined;
};

/** "Hoje", "Amanhã" ou "6 nov". */
export function dueLabel(iso: string | null, today: string, tomorrow: string) {
  if (!iso) return null;
  if (iso === today) return "Hoje";
  if (iso === tomorrow) return "Amanhã";
  const d = fromIso(iso);
  return d ? format(d, "d MMM", { locale: ptBR }) : iso;
}

export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

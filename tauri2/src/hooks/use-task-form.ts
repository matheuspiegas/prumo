import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as pickFiles } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, imageMime, type Attachment, type Task } from "@/lib/api";
import { imageFileName, imageNumber, nextImageNumber } from "@/lib/note-tokens";
import { MAX_IMAGE_BYTES, PASTE_TYPES } from "@/components/note-images";
import type { NoteImage } from "@/components/notes-editor/image-context";
import type { ImageRef } from "@/components/notes-editor/notes-editor";

/** Imagem colada numa tarefa nova: fica em memória até a tarefa ser criada (ainda não há id). */
type PastedImage = { n: number; name: string; bytes: ArrayBuffer; url: string };

type Options = {
  open: boolean;
  /** `null` = nova tarefa */
  task: Task | null;
  defaultDate: string | null;
  defaultTags?: string[];
  onClose: () => void;
  onSaved: () => void;
};

type Snapshot = { title: string; notes: string; date: string | null; priority: number; recurrence: string | null; time: string | null; tags: string };

/**
 * Estado e ações do diálogo de tarefa: campos, anexos (arquivos e imagens coladas), salvar e a
 * detecção de alterações não salvas. A tela (layout compacto ou expandido) só desenha isto.
 */
export function useTaskForm({ open, task, defaultDate, defaultTags, onClose, onSaved }: Options) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [recurrence, setRecurrence] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [saved, setSaved] = useState<Attachment[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [pastedImgs, setPastedImgs] = useState<PastedImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Muda a cada abertura; o editor usa como `key` para recarregar o texto. */
  const [resetKey, setResetKey] = useState(0);

  const initial = useRef<Snapshot | null>(null);
  const pastedRef = useRef<PastedImage[]>([]);
  pastedRef.current = pastedImgs;

  const loadAttachments = useCallback(async (id: number) => setSaved(await api.attachments(id)), []);

  // Libera as URLs das imagens em memória ao desmontar.
  useEffect(() => () => pastedRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  useEffect(() => {
    if (!open) return;
    pastedRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    setPastedImgs([]);
    const t = {
      title: task?.title ?? "",
      notes: task?.notes ?? "",
      date: task ? task.due : defaultDate,
      priority: task?.priority ?? 0,
      recurrence: task?.recurrence ?? null,
      time: task?.dueTime ?? null,
      tags: task?.tags ?? defaultTags ?? [],
    };
    setTitle(t.title);
    setNotes(t.notes);
    setDate(t.date);
    setPriority(t.priority);
    setRecurrence(t.recurrence);
    setTime(t.time);
    setTags(t.tags);
    setPending([]);
    setSaved([]);
    initial.current = { ...t, tags: JSON.stringify(t.tags) };
    setResetKey((k) => k + 1);
    if (task) loadAttachments(task.id).catch((e) => toast.error(String(e)));
  }, [open, task, defaultDate, defaultTags, loadAttachments]);

  // ---------- anexos de arquivo ----------

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

  // Arrastar e soltar arquivos do Explorer (o webview entrega os caminhos).
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

  const chooseFiles = async () => {
    const res = await pickFiles({ multiple: true });
    if (res) addPaths(Array.isArray(res) ? res : [res]);
  };

  const removeSaved = async (a: Attachment) => {
    await api.detach(a.id);
    if (task) loadAttachments(task.id);
    onSaved();
  };

  // ---------- imagens das notas ----------

  /** As imagens da tarefa, na forma que o editor entende (salvas e em memória). */
  const images: NoteImage[] = useMemo(
    () => [
      ...saved.filter((a) => imageMime(a.filename)).map((a) => ({ n: imageNumber(a.filename), name: a.filename, id: a.id })),
      ...pastedImgs.map((p) => ({ n: p.n, name: p.name, url: p.url })),
    ],
    [saved, pastedImgs],
  );

  /** Ctrl+V com imagem: salva como anexo `image-N.ext` e devolve os números para o editor inserir. */
  const pasteImages = async (files: File[]): Promise<number[]> => {
    const names = [...saved.map((a) => a.filename), ...pastedRef.current.map((i) => i.name)];
    const added: { n: number; name: string; bytes: ArrayBuffer }[] = [];
    for (const f of files) {
      if (!PASTE_TYPES.includes(f.type)) {
        toast.error(`Formato de imagem não suportado (${f.type}). Use PNG, JPEG, GIF ou WebP.`);
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        toast.error(`A imagem tem mais de ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      const n = nextImageNumber(names);
      const name = imageFileName(n, f.type);
      names.push(name);
      added.push({ n, name, bytes: await f.arrayBuffer() });
    }
    if (!added.length) return [];
    try {
      if (task) {
        for (const a of added) await api.attachBytes(task.id, a.name, a.bytes);
        await loadAttachments(task.id);
        onSaved();
      } else {
        setPastedImgs((cur) => [
          ...cur,
          ...added.map((a) => ({ ...a, url: URL.createObjectURL(new Blob([a.bytes], { type: imageMime(a.name) ?? "image/png" })) })),
        ]);
      }
    } catch (err) {
      toast.error(`Não foi possível anexar a imagem: ${err}`);
      return [];
    }
    return added.map((a) => a.n);
  };

  /** Remove o arquivo da imagem. O chamador também tira o token do texto (`NotesEditorHandle.removeImage`). */
  const removeImage = async (ref: ImageRef) => {
    const mem = pastedRef.current.find((i) => (ref.n != null ? i.n === ref.n : i.name === ref.name));
    if (mem) {
      URL.revokeObjectURL(mem.url);
      setPastedImgs((cur) => cur.filter((i) => i !== mem));
      return;
    }
    const att = saved.find((a) => (ref.n != null ? imageNumber(a.filename) === ref.n : a.filename === ref.name));
    if (att) await removeSaved(att);
  };

  // ---------- salvar ----------

  const dirty =
    !!initial.current &&
    (title !== initial.current.title ||
      notes !== initial.current.notes ||
      date !== initial.current.date ||
      priority !== initial.current.priority ||
      recurrence !== initial.current.recurrence ||
      time !== initial.current.time ||
      JSON.stringify(tags) !== initial.current.tags ||
      pending.length > 0 ||
      pastedImgs.length > 0);

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
        for (const img of pastedRef.current) await api.attachBytes(id, img.name, img.bytes);
        if (tags.length) await api.setTags(id, tags);
      }
      initial.current = null; // salvo: nada pendente, fechar não pergunta
      onSaved();
      onClose();
    } catch (e) {
      toast.error(`Não foi possível salvar: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return {
    // campos
    title, setTitle, notes, setNotes, date, setDate, priority, setPriority,
    recurrence, setRecurrence, time, setTime, tags, setTags,
    // anexos
    saved, pending, setPending, dragging, chooseFiles, removeSaved,
    // imagens
    images, pasteImages, removeImage,
    // estado
    resetKey, saving, dirty, save,
  };
}

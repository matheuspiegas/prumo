import { useCallback, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { imageToken, stripImageToken } from "@/lib/note-tokens";
import { noteExtensions } from "./extensions";
import { ImageToken } from "./image-token-view";
import { NoteImagesContext, type NoteImage } from "./image-context";
import { NotesToolbar } from "./toolbar";

/** Referência a uma imagem da tarefa: pelo número do token, ou pelo nome nas notas antigas. */
export type ImageRef = { n: number | null; name: string };

export type NotesEditorHandle = {
  /** Insere as imagens no cursor (como tokens `[Image #N]`). */
  insertImages: (refs: ImageRef[]) => void;
  /** Tira do texto todos os tokens de uma imagem. */
  removeImage: (ref: ImageRef) => void;
};

type Props = {
  ref?: Ref<NotesEditorHandle>;
  /** Markdown de partida. Só vale na criação: para trocar o conteúdo, remonte com outra `key`. */
  initialMarkdown: string;
  images: NoteImage[];
  variant: "compact" | "expanded";
  /** Chamado a cada edição do usuário, com o markdown completo. Não é chamado ao abrir. */
  onChange: (markdown: string) => void;
  /** Recebe as imagens coladas e devolve os números dos tokens a inserir (`[]` se falhar). */
  onPasteImages: (files: File[]) => Promise<number[]>;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
};

/** Palavras do texto, sem contar os tokens de imagem. */
const countWords = (t: string) => {
  const plain = t.replace(/\[Image #\d+\]|!\[[^\]\n]*\]\(anexo:[^)\n]+\)/g, " ").trim();
  return plain ? plain.split(/\s+/).length : 0;
};

/** Só http(s) e mailto saem do app; qualquer outra coisa é ignorada. */
function openExternal(href: string | null) {
  if (href && /^(https?:|mailto:)/i.test(href)) openUrl(href).catch(() => {});
}

/**
 * Editor de notas em markdown (Tiptap). A nota continua sendo um texto markdown simples no banco, e só
 * é reescrita quando o usuário edita, para não alterar notas escritas por agentes.
 */
export function NotesEditor({ ref, initialMarkdown, images, variant, onChange, onPasteImages, onSubmit, placeholder, className }: Props) {
  const [source, setSource] = useState(false);
  const [sourceText, setSourceText] = useState(initialMarkdown);
  const [words, setWords] = useState(() => countWords(initialMarkdown));
  const latest = useRef(initialMarkdown); // último markdown conhecido (texto original até a primeira edição)
  const cb = useRef({ onChange, onPasteImages, onSubmit });
  cb.current = { onChange, onPasteImages, onSubmit };
  const editorRef = useRef<Editor | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const extensions = useMemo(
    () => [...noteExtensions(ImageToken), Placeholder.configure({ placeholder: placeholder ?? "Escreva em markdown…" })],
    [placeholder],
  );

  const insertAt = (tokens: string) => {
    const el = areaRef.current;
    const text = latest.current;
    const from = el?.selectionStart ?? text.length;
    const to = el?.selectionEnd ?? text.length;
    const next = text.slice(0, from) + tokens + text.slice(to);
    latest.current = next;
    setSourceText(next);
    cb.current.onChange(next);
  };

  const pasteImages = async (files: File[]) => {
    const ns = await cb.current.onPasteImages(files);
    if (ns.length) handle().insertImages(ns.map((n) => ({ n, name: "" })));
  };

  const editor = useEditor({
    extensions,
    content: initialMarkdown,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "note-prose", "aria-label": "Notas" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false; // texto e HTML colados seguem o caminho normal
        event.preventDefault();
        void pasteImages(files);
        return true;
      },
      handleKeyDown: (_view, e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          cb.current.onSubmit?.();
          return true;
        }
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest("a");
        if (a && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          openExternal(a.getAttribute("href"));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = ed.getMarkdown().trim();
      latest.current = md;
      setWords(countWords(md));
      cb.current.onChange(md);
    },
  });
  editorRef.current = editor;

  const handle = (): NotesEditorHandle => ({
    insertImages: (refs) => {
      if (source) {
        insertAt(refs.map((r) => (r.n != null ? imageToken(r.n) : `![${r.name}](anexo:${r.name})`)).join(" ") + " ");
        return;
      }
      const ed = editorRef.current;
      if (!ed) return;
      const content = refs.flatMap((r) => [
        { type: "imageToken", attrs: { n: r.n, name: r.n == null ? r.name : null } },
        { type: "text", text: " " },
      ]);
      ed.chain().focus().insertContent(content).run();
    },
    removeImage: (r) => {
      if (source) {
        const next = stripImageToken(latest.current, { n: r.n, name: r.n == null ? r.name : null });
        latest.current = next;
        setSourceText(next);
        cb.current.onChange(next);
        return;
      }
      const ed = editorRef.current;
      if (!ed) return;
      const hits: { from: number; to: number }[] = [];
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name !== "imageToken") return;
        const same = r.n != null ? node.attrs.n === r.n : node.attrs.name === r.name;
        if (same) hits.push({ from: pos, to: pos + node.nodeSize });
      });
      if (!hits.length) return;
      const tr = ed.state.tr;
      for (const h of hits.reverse()) tr.delete(h.from, h.to);
      ed.view.dispatch(tr);
    },
  });
  useImperativeHandle(ref, handle);

  const toggleSource = useCallback(() => {
    if (!source) {
      setSourceText(latest.current);
      setSource(true);
    } else {
      editorRef.current?.commands.setContent(sourceText, { contentType: "markdown", emitUpdate: false });
      setSource(false);
    }
  }, [source, sourceText]);

  const ctx = useMemo(
    () => ({
      find: (n: number | null, name: string | null) => images.find((i) => (n != null ? i.n === n : i.name === name)),
    }),
    [images],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        className,
      )}
    >
      <NotesToolbar editor={editor} variant={variant} source={source} onToggleSource={toggleSource} />
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", variant === "compact" ? "min-h-44" : "min-h-64")}>
        {source ? (
          <textarea
            ref={areaRef}
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              setWords(countWords(e.target.value));
              latest.current = e.target.value;
              cb.current.onChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                cb.current.onSubmit?.();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (!files.length) return;
              e.preventDefault();
              void pasteImages(files);
            }}
            spellCheck={false}
            aria-label="Notas em markdown"
            className="block size-full min-h-44 resize-none bg-transparent p-3 font-mono text-sm outline-none"
          />
        ) : (
          <NoteImagesContext.Provider value={ctx}>
            <EditorContent editor={editor} className="note-editor flex-1" />
          </NoteImagesContext.Provider>
        )}
      </div>
      {variant === "expanded" && (
        <div className="flex justify-end gap-3 border-t bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
          <span>{words} {words === 1 ? "palavra" : "palavras"}</span>
          <span>Ctrl+Enter salva</span>
        </div>
      )}
    </div>
  );
}

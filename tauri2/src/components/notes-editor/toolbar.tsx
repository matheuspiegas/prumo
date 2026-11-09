import { useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Code2,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Não tira o foco do editor ao clicar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />;

/** Acrescenta https:// quando o usuário digita só o domínio; aceita http(s) e mailto. */
export function normalizeHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^(https?:|mailto:)/i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null; // outros esquemas (javascript:, file:…) não entram
  return `https://${t}`;
}

function LinkTool({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const active = editor.isActive("link");

  const apply = () => {
    const url = normalizeHref(href);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href.trim()) chain.unsetLink().run();
    else if (url) chain.setLink({ href: url }).run();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setHref(editor.getAttributes("link").href ?? "");
        setOpen(o);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Link"
            aria-label="Link"
            aria-pressed={active}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
              active && "bg-accent text-foreground",
            )}
          />
        }
      >
        <Link2 />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Input autoFocus value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://…" className="h-8" />
          <Button type="submit" size="sm">
            {href.trim() ? "Aplicar" : "Remover"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

type Props = {
  editor: Editor | null;
  variant: "compact" | "expanded";
  source: boolean;
  onToggleSource: () => void;
};

/** Barra de formatação: enxuta no layout compacto, completa no expandido. */
export function NotesToolbar({ editor, variant, source, onToggleSource }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: !!e?.isActive("bold"),
      italic: !!e?.isActive("italic"),
      strike: !!e?.isActive("strike"),
      code: !!e?.isActive("code"),
      h1: !!e?.isActive("heading", { level: 1 }),
      h2: !!e?.isActive("heading", { level: 2 }),
      h3: !!e?.isActive("heading", { level: 3 }),
      bullet: !!e?.isActive("bulletList"),
      ordered: !!e?.isActive("orderedList"),
      task: !!e?.isActive("taskList"),
      quote: !!e?.isActive("blockquote"),
      codeBlock: !!e?.isActive("codeBlock"),
      table: !!e?.isActive("table"),
      canUndo: !!e?.can().undo(),
      canRedo: !!e?.can().redo(),
    }),
  });
  if (!editor || !s) return null;
  const off = source; // em modo markdown a formatação é feita digitando
  const run = () => editor.chain().focus();
  const full = variant === "expanded";

  return (
    <div role="toolbar" aria-label="Formatação" className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-1.5 py-1">
      {full && (
        <>
          <Tool label="Desfazer (Ctrl+Z)" disabled={off || !s.canUndo} onClick={() => run().undo().run()}>
            <Undo2 />
          </Tool>
          <Tool label="Refazer (Ctrl+Shift+Z)" disabled={off || !s.canRedo} onClick={() => run().redo().run()}>
            <Redo2 />
          </Tool>
          <Sep />
          <Tool label="Título 1" active={s.h1} disabled={off} onClick={() => run().toggleHeading({ level: 1 }).run()}>
            <Heading1 />
          </Tool>
          <Tool label="Título 2" active={s.h2} disabled={off} onClick={() => run().toggleHeading({ level: 2 }).run()}>
            <Heading2 />
          </Tool>
          <Tool label="Título 3" active={s.h3} disabled={off} onClick={() => run().toggleHeading({ level: 3 }).run()}>
            <Heading3 />
          </Tool>
          <Sep />
        </>
      )}
      <Tool label="Negrito (Ctrl+B)" active={s.bold} disabled={off} onClick={() => run().toggleBold().run()}>
        <Bold />
      </Tool>
      <Tool label="Itálico (Ctrl+I)" active={s.italic} disabled={off} onClick={() => run().toggleItalic().run()}>
        <Italic />
      </Tool>
      <Tool label="Riscado" active={s.strike} disabled={off} onClick={() => run().toggleStrike().run()}>
        <Strikethrough />
      </Tool>
      <Tool label="Código em linha" active={s.code} disabled={off} onClick={() => run().toggleCode().run()}>
        <Code />
      </Tool>
      <LinkTool editor={editor} disabled={off} />
      <Sep />
      <Tool label="Lista" active={s.bullet} disabled={off} onClick={() => run().toggleBulletList().run()}>
        <List />
      </Tool>
      <Tool label="Lista numerada" active={s.ordered} disabled={off} onClick={() => run().toggleOrderedList().run()}>
        <ListOrdered />
      </Tool>
      <Tool label="Checklist" active={s.task} disabled={off} onClick={() => run().toggleTaskList().run()}>
        <ListChecks />
      </Tool>
      <Tool label="Citação" active={s.quote} disabled={off} onClick={() => run().toggleBlockquote().run()}>
        <Quote />
      </Tool>
      {full && (
        <>
          <Tool label="Bloco de código" active={s.codeBlock} disabled={off} onClick={() => run().toggleCodeBlock().run()}>
            <Code2 />
          </Tool>
          <Tool
            label="Tabela"
            active={s.table}
            disabled={off}
            onClick={() => (s.table ? run().deleteTable().run() : run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
          >
            <Table2 />
          </Tool>
          <Tool label="Linha separadora" disabled={off} onClick={() => run().setHorizontalRule().run()}>
            <Minus />
          </Tool>
          {s.table && !off && (
            <>
              <Sep />
              <Button type="button" variant="ghost" size="xs" onMouseDown={(e) => e.preventDefault()} onClick={() => run().addRowAfter().run()}>
                + linha
              </Button>
              <Button type="button" variant="ghost" size="xs" onMouseDown={(e) => e.preventDefault()} onClick={() => run().addColumnAfter().run()}>
                + coluna
              </Button>
            </>
          )}
          <span className="flex-1" />
          <Button type="button" variant={source ? "secondary" : "ghost"} size="xs" aria-pressed={source} onClick={onToggleSource}>
            <FileCode2 data-icon="inline-start" /> Markdown
          </Button>
        </>
      )}
    </div>
  );
}

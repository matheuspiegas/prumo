import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { AnyExtension } from "@tiptap/core";
import { ImageTokenBase } from "./image-token";

/** Extensões do editor de notas (sem a parte visual da imagem, que o componente acrescenta). */
export function noteExtensions(imageToken: AnyExtension = ImageTokenBase): AnyExtension[] {
  return [
    StarterKit.configure({
      // Links só abrem com Ctrl+clique (e fora do app); a navegação do webview nunca é usada.
      link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    imageToken,
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}

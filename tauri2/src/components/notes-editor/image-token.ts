import { Node } from "@tiptap/core";
import { findImageToken, imageToken, matchImageToken } from "@/lib/note-tokens";

/**
 * Nó inline que representa uma imagem colada. No markdown vira o texto `[Image #N]` (ou, nas notas
 * antigas, `![nome](anexo:nome)`, que é escrito de volta como estava). Só o esquema e a conversão de
 * markdown ficam aqui; a miniatura (React) é acrescentada em `image-token-view.tsx`.
 */
export const ImageTokenBase = Node.create({
  name: "imageToken",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { n: { default: null }, name: { default: null } };
  },

  parseHTML() {
    return [{ tag: "span[data-image-token]" }];
  },

  renderHTML({ node }) {
    return ["span", { "data-image-token": "", class: "image-token" }, node.attrs.n != null ? imageToken(node.attrs.n) : `${node.attrs.name}`];
  },

  markdownTokenName: "imageToken",

  markdownTokenizer: {
    name: "imageToken",
    level: "inline",
    start: (src: string) => findImageToken(src),
    tokenize: (src: string) => {
      const m = matchImageToken(src);
      if (!m) return undefined;
      return { type: "imageToken", raw: m.raw, n: m.n, name: m.name };
    },
  },

  parseMarkdown: (token) => ({
    type: "imageToken",
    attrs: { n: (token as { n?: number | null }).n ?? null, name: (token as { name?: string | null }).name ?? null },
  }),

  renderMarkdown: (node) => {
    const { n, name } = node.attrs ?? {};
    return n != null ? imageToken(n) : `![${name}](anexo:${name})`;
  },
});

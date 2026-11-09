// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { noteExtensions } from "./extensions";

/** Abre `md` no editor (sem DOM visível) e devolve o markdown serializado de volta. */
function roundtrip(md: string): string {
  const editor = new Editor({ extensions: noteExtensions(), content: md, contentType: "markdown" });
  const out = editor.getMarkdown().trim();
  editor.destroy();
  return out;
}

function nodeTypes(md: string): string[] {
  const editor = new Editor({ extensions: noteExtensions(), content: md, contentType: "markdown" });
  const types: string[] = [];
  editor.state.doc.descendants((n) => {
    types.push(n.type.name);
  });
  editor.destroy();
  return types;
}

describe("ida e volta do markdown das notas", () => {
  it("preserva o token [Image #N] no meio do texto", () => {
    const md = "Erro ao salvar:\n\n[Image #1]\n\nDepois de clicar [Image #2] some.";
    const out = roundtrip(md);
    expect(out).toContain("[Image #1]");
    expect(out).toContain("[Image #2]");
    expect(nodeTypes(md).filter((t) => t === "imageToken")).toHaveLength(2);
  });

  it("lê o formato antigo ![nome](anexo:nome) e escreve de volta igual", () => {
    const md = "![imagem-20261109-1530-1.png](anexo:imagem-20261109-1530-1.png)";
    expect(nodeTypes(md)).toContain("imageToken");
    expect(roundtrip(md)).toBe(md);
  });

  it("mantém formatação comum", () => {
    const md = [
      "# Título",
      "",
      "Texto com **negrito**, *itálico*, ~~riscado~~ e `código`.",
      "",
      "- item 1",
      "- item 2",
      "",
      "1. um",
      "2. dois",
      "",
      "- [ ] a fazer",
      "- [x] feito",
      "",
      "> citação",
      "",
      "```",
      "let x = 1;",
      "```",
      "",
      "[link](https://exemplo.com)",
    ].join("\n");
    const out = roundtrip(md);
    for (const trecho of ["# Título", "**negrito**", "*itálico*", "~~riscado~~", "`código`", "- item 1", "1. um", "- [ ] a fazer", "- [x] feito", "> citação", "let x = 1;", "[link](https://exemplo.com)"]) {
      expect(out).toContain(trecho);
    }
  });

  it("lê tabelas", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(nodeTypes(md)).toContain("table");
    expect(roundtrip(md)).toBe(["| a   | b   |", "| --- | --- |", "| 1   | 2   |"].join("\n"));
  });

  it("HTML cru não vira elemento do editor (só os tipos do esquema)", () => {
    const md = 'Oi <script>alert(1)</script> <img src=x onerror="alert(2)"> fim';
    const types = new Set(nodeTypes(md));
    const permitidos = new Set(["doc", "paragraph", "text", "imageToken", "hardBreak"]);
    for (const t of types) expect(permitidos.has(t)).toBe(true);
    const editor = new Editor({ extensions: noteExtensions(), content: md, contentType: "markdown" });
    expect(editor.getHTML()).not.toMatch(/<script|onerror/i);
    editor.destroy();
  });
});

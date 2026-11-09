// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NotesEditor, type NotesEditorHandle } from "./notes-editor";
import type { NoteImage } from "./image-context";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject("sem backend")) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // O jsdom não implementa medidas de layout que o ProseMirror consulta ao focar/rolar.
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

type Setup = { md?: string; images?: NoteImage[]; variant?: "compact" | "expanded"; paste?: (f: File[]) => Promise<number[]> };

async function mount({ md = "", images = [], variant = "compact", paste = async () => [] }: Setup = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const onChange = vi.fn();
  const onPasteImages = vi.fn(paste);
  const ref = createRef<NotesEditorHandle>();
  await act(async () => {
    root!.render(<NotesEditor ref={ref} initialMarkdown={md} images={images} variant={variant} onChange={onChange} onPasteImages={onPasteImages} />);
  });
  return { host, onChange, onPasteImages, ref, pm: () => host!.querySelector(".ProseMirror") as HTMLElement };
}

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });

function pasteEvent(files: File[]) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { files, items: [], types: ["Files"], getData: () => "" } });
  return ev;
}

describe("NotesEditor", () => {
  it("abre com o token como miniatura e sem chamar onChange", async () => {
    const { host, onChange } = await mount({
      md: "Veja [Image #1] aqui",
      images: [{ n: 1, name: "image-1.png", url: "blob:teste" }],
    });
    expect(host.querySelector('img[src="blob:teste"]')).not.toBeNull();
    expect(host.textContent).toContain("Image #1");
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("colar uma imagem pede o salvamento e insere o token [Image #N] no texto", async () => {
    const { pm, onChange, onPasteImages } = await mount({ md: "", paste: async () => [1] });
    const file = png();
    await act(async () => {
      pm().dispatchEvent(pasteEvent([file]));
    });
    expect(onPasteImages).toHaveBeenCalledWith([file]);
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall![0]).toContain("[Image #1]");
  });

  it("colar imagem que falhou ao salvar não insere nada", async () => {
    const { pm, onChange } = await mount({ md: "", paste: async () => [] });
    await act(async () => {
      pm().dispatchEvent(pasteEvent([png()]));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removeImage tira o token do texto", async () => {
    const { ref, onChange } = await mount({
      md: "antes [Image #1] depois [Image #2]",
      images: [
        { n: 1, name: "image-1.png", url: "blob:1" },
        { n: 2, name: "image-2.png", url: "blob:2" },
      ],
    });
    await act(async () => ref.current!.removeImage({ n: 1, name: "image-1.png" }));
    const md = onChange.mock.lastCall![0] as string;
    expect(md).not.toContain("[Image #1]");
    expect(md).toContain("[Image #2]");
  });

  it("insertImages põe os tokens no cursor", async () => {
    const { ref, onChange } = await mount({ md: "texto" });
    await act(async () => ref.current!.insertImages([{ n: 4, name: "image-4.png" }]));
    expect(onChange.mock.lastCall![0]).toContain("[Image #4]");
  });

  it("modo markdown mostra o texto original sem reescrever e propaga a digitação", async () => {
    const original = "* item com asterisco\n\nTexto   com  espaços";
    const { host, onChange } = await mount({ md: original, variant: "expanded" });
    const toggle = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Markdown"))!;
    await act(async () => toggle.click());
    const area = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(area.value).toBe(original); // nada foi editado: o texto não é normalizado
    expect(onChange).not.toHaveBeenCalled();

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(area, "novo texto");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("novo texto");
  });

  it("layout compacto não tem o botão de modo markdown nem a contagem de palavras", async () => {
    const { host } = await mount({ md: "um dois três", variant: "compact" });
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent?.includes("Markdown"))).toBe(false);
    expect(host.textContent).not.toContain("palavras");
  });

  it("layout expandido mostra a contagem de palavras", async () => {
    const { host } = await mount({ md: "um dois três", variant: "expanded" });
    expect(host.textContent).toContain("3 palavras");
  });
});

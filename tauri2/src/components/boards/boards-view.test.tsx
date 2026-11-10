// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board } from "@/lib/api";

const h = vi.hoisted(() => ({
  boards: {
    list: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    readThumbnail: vi.fn(),
  },
  listeners: [] as Array<() => void>,
}));

vi.mock("@/lib/api", () => ({ api: { boards: h.boards } }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, cb: () => void) => {
    h.listeners.push(cb);
    return Promise.resolve(() => {
      h.listeners = h.listeners.filter((x) => x !== cb);
    });
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// O Excalidraw nunca carrega nos testes.
vi.mock("./board-canvas", () => ({
  BoardCanvas: ({ boardId, onSaveState }: { boardId: number; onSaveState?: (s: "saving" | "saved" | "error") => void }) => (
    <div data-testid="canvas">
      canvas {boardId}
      <button onClick={() => onSaveState?.("saving")}>simular-salvando</button>
      <button onClick={() => onSaveState?.("error")}>simular-erro</button>
    </div>
  ),
}));

import { BoardsView } from "./boards-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const board = (id: number, name: string, extra: Partial<Board> = {}): Board => ({
  id,
  name,
  createdAt: "2026-01-01 10:00:00",
  updatedAt: "2026-01-01 10:00:00",
  hasThumbnail: false,
  ...extra,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  URL.createObjectURL = vi.fn(() => "blob:miniatura");
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  h.listeners = [];
  Object.values(h.boards).forEach((f) => f.mockReset());
  h.boards.list.mockResolvedValue([board(1, "Fluxo de login"), board(2, "Arquitetura")]);
  h.boards.rename.mockResolvedValue(undefined);
  h.boards.remove.mockResolvedValue(undefined);
  h.boards.readThumbnail.mockResolvedValue(new ArrayBuffer(4));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<BoardsView />));
  await flush();
}

const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const byText = (text: string, tag = "button") =>
  [...document.body.querySelectorAll<HTMLElement>(tag)].find((e) => e.textContent?.trim() === text) ?? null;
const click = async (el: Element | null) => {
  if (!el) throw new Error("elemento não encontrado");
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = async (el: Element, k: string) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
  await flush();
};
const openCardMenu = (name: string) => click(q(`[aria-label="Ações do quadro ${name}"]`));

describe("BoardsView", () => {
  it("lista os quadros em cartões", async () => {
    await mount();
    expect(document.body.textContent).toContain("Fluxo de login");
    expect(document.body.textContent).toContain("Arquitetura");
    expect(q('[aria-label="Abrir quadro Fluxo de login"]')).not.toBeNull();
    expect(document.body.textContent).toContain("atualizado");
    expect(document.body.querySelectorAll('[data-testid="thumb-placeholder"]').length).toBe(2);
  });

  it("mostra a miniatura quando existe", async () => {
    h.boards.list.mockResolvedValue([board(1, "Com imagem", { hasThumbnail: true })]);
    await mount();
    expect(h.boards.readThumbnail).toHaveBeenCalledWith(1);
    expect(q("img")?.getAttribute("src")).toBe("blob:miniatura");
    await act(async () => root?.unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:miniatura");
    root = null;
  });

  it("mostra o estado vazio", async () => {
    h.boards.list.mockResolvedValue([]);
    await mount();
    expect(document.body.textContent).toContain("Nenhum quadro ainda.");
    expect(byText("Novo quadro")).not.toBeNull();
  });

  it("criar abre o quadro novo", async () => {
    h.boards.create.mockResolvedValue(board(3, "Quadro sem título"));
    await mount();
    await click(byText("Novo quadro"));
    expect(h.boards.create).toHaveBeenCalled();
    expect(q('[data-testid="canvas"]')?.textContent).toContain("canvas 3");
    expect(document.body.textContent).toContain("Quadro sem título");
    expect(byText("Quadros")).not.toBeNull(); // botão voltar
  });

  it("renomear: Enter grava", async () => {
    await mount();
    await openCardMenu("Fluxo de login");
    await click(byText("Renomear"));
    const input = q('input[aria-label="Nome do quadro"]') as HTMLInputElement;
    expect(input.value).toBe("Fluxo de login");
    await type(input, "  Novo nome ");
    await key(input, "Enter");
    expect(h.boards.rename).toHaveBeenCalledWith(1, "Novo nome");
    expect(q('input[aria-label="Nome do quadro"]')).toBeNull();
    expect(document.body.textContent).toContain("Novo nome");
  });

  it("renomear: Esc cancela e nome vazio não grava", async () => {
    await mount();
    await openCardMenu("Fluxo de login");
    await click(byText("Renomear"));
    let input = q('input[aria-label="Nome do quadro"]') as HTMLInputElement;
    await type(input, "Outro");
    await key(input, "Escape");
    expect(h.boards.rename).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Fluxo de login");

    await openCardMenu("Fluxo de login");
    await click(byText("Renomear"));
    input = q('input[aria-label="Nome do quadro"]') as HTMLInputElement;
    await type(input, "   ");
    await key(input, "Enter");
    expect(h.boards.rename).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Fluxo de login");
  });

  it("duplicar chama a API e recarrega a lista", async () => {
    h.boards.duplicate.mockResolvedValue(board(9, "Cópia de Fluxo de login"));
    await mount();
    const calls = h.boards.list.mock.calls.length;
    await openCardMenu("Fluxo de login");
    await click(byText("Duplicar"));
    expect(h.boards.duplicate).toHaveBeenCalledWith(1);
    expect(h.boards.list.mock.calls.length).toBeGreaterThan(calls);
  });

  it("excluir exige confirmação; cancelar não exclui", async () => {
    await mount();
    await openCardMenu("Arquitetura");
    await click(byText("Excluir"));
    expect(document.body.textContent).toContain("Excluir quadro?");
    expect(document.body.textContent).toContain("definitiva");
    expect(h.boards.remove).not.toHaveBeenCalled();
    await click(byText("Cancelar"));
    expect(h.boards.remove).not.toHaveBeenCalled();

    await openCardMenu("Arquitetura");
    await click(byText("Excluir"));
    await click([...document.body.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Excluir").pop()!);
    expect(h.boards.remove).toHaveBeenCalledWith(2);
  });

  it("voltar recarrega a lista e o indicador de gravação segue o canvas", async () => {
    await mount();
    await click(q('[aria-label="Abrir quadro Fluxo de login"]'));
    expect(q('[data-testid="canvas"]')).not.toBeNull();
    expect(q('[role="status"]')?.textContent).toBe("Salvo");
    await click(byText("simular-salvando"));
    expect(q('[role="status"]')?.textContent).toBe("Salvando…");
    await click(byText("simular-erro"));
    expect(q('[role="status"]')?.textContent).toBe("Erro ao salvar");

    const calls = h.boards.list.mock.calls.length;
    await click(q('[aria-label="Voltar para Quadros"]'));
    expect(q('[data-testid="canvas"]')).toBeNull();
    expect(h.boards.list.mock.calls.length).toBeGreaterThan(calls);
    expect(document.body.textContent).toContain("Arquitetura");
  });

  it("renomear o quadro aberto pela barra", async () => {
    await mount();
    await click(q('[aria-label="Abrir quadro Fluxo de login"]'));
    await click(q('[aria-label="Renomear quadro Fluxo de login"]'));
    const input = q('input[aria-label="Nome do quadro"]') as HTMLInputElement;
    await type(input, "Renomeado");
    await key(input, "Enter");
    expect(h.boards.rename).toHaveBeenCalledWith(1, "Renomeado");
    expect(q('[aria-label="Renomear quadro Renomeado"]')).not.toBeNull();
  });

  it("atualiza a lista com o evento boards-changed", async () => {
    await mount();
    h.boards.list.mockResolvedValue([board(1, "Fluxo de login"), board(2, "Arquitetura"), board(5, "Chegou de fora")]);
    await act(async () => h.listeners.forEach((cb) => cb()));
    await flush();
    expect(document.body.textContent).toContain("Chegou de fora");
  });
});

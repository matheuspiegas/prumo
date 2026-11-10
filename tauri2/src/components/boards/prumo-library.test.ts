import { beforeAll, describe, expect, it } from "vitest";
import type { LibraryItems } from "@excalidraw/excalidraw/types";

let items: LibraryItems;
let loadLibraryFromBlob: typeof import("@excalidraw/excalidraw").loadLibraryFromBlob;

beforeAll(async () => {
  // O jsdom não tem canvas 2D: um stub simples basta para a medição de texto do Excalidraw.
  const ctx = {
    font: "",
    measureText: (t: string) => ({ width: t.length * 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }),
  };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // Idem para FontFace (o registro de fontes do Excalidraw só precisa que a classe exista).
  (globalThis as Record<string, unknown>).FontFace = class {
    load() {
      return Promise.resolve(this);
    }
  };
  const mod = await import("./prumo-library");
  items = mod.getPrumoLibraryItems();
  loadLibraryFromBlob = (await import("@excalidraw/excalidraw")).loadLibraryFromBlob;
});

describe("biblioteca Prumo", () => {
  it("gera cerca de 30 itens", () => {
    expect(items.length).toBeGreaterThanOrEqual(28);
    expect(items.length).toBeLessThanOrEqual(34);
  });

  it("é memoizada e o export nomeado tem o mesmo conteúdo", async () => {
    const mod = await import("./prumo-library");
    expect(mod.getPrumoLibraryItems()).toBe(items);
    expect(mod.PRUMO_LIBRARY_ITEMS).toHaveLength(items.length);
  });

  it("ids únicos com prefixo prumo-, publicados, com nome em português", () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of items) {
      expect(item.id.startsWith("prumo-")).toBe(true);
      expect(item.status).toBe("published");
      expect(item.name && item.name.length > 2).toBe(true);
    }
    const nomes = items.map((i) => i.name);
    for (const esperado of ["Fluxograma: Processo", "Fluxograma: Decisão", "Banco de dados", "Nuvem", "UML: Classe", "Estrela"]) {
      expect(nomes).toContain(esperado);
    }
  });

  it("cada item tem elementos, todos num único grupo, sem sobras e perto de (0,0)", () => {
    for (const item of items) {
      expect(item.elements.length).toBeGreaterThan(0);
      const grupos = new Set(item.elements.map((e) => e.groupIds.join("|")));
      expect(grupos.size, item.id).toBe(1);
      expect(item.elements[0].groupIds.length).toBe(1);
      const canto = (e: (typeof item.elements)[number], eixo: 0 | 1) =>
        (eixo === 0 ? e.x : e.y) + ("points" in e ? Math.min(...e.points.map((p) => p[eixo])) : 0);
      expect(Math.min(...item.elements.map((e) => canto(e, 0)))).toBeCloseTo(0, 5);
      expect(Math.min(...item.elements.map((e) => canto(e, 1)))).toBeCloseTo(0, 5);
      for (const el of item.elements) {
        if (el.type === "line") {
          const xs = el.points.map((p) => p[0]);
          const ys = el.points.map((p) => p[1]);
          expect(el.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 5);
          expect(el.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 5);
        }
        expect(Number.isFinite(el.x) && Number.isFinite(el.y)).toBe(true);
        expect(el.isDeleted).toBe(false);
      }
    }
  });

  it("rótulos vinculados apontam para um container do mesmo item", () => {
    for (const item of items) {
      const ids = new Set(item.elements.map((e) => e.id));
      for (const el of item.elements) {
        if (el.type === "text" && el.containerId) expect(ids.has(el.containerId), item.id).toBe(true);
      }
    }
  });

  it("ida e volta como .excalidrawlib", async () => {
    const json = JSON.stringify({ type: "excalidrawlib", version: 2, libraryItems: items });
    const blob = new Blob([json], { type: "application/json" });
    const carregados = await loadLibraryFromBlob(blob);
    expect(carregados.length).toBe(items.length);
  });
});

// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  handler: null as null | ((e: { payload: unknown }) => void),
  unlisten: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  readDroppedFile: vi.fn(),
  loadLibraryFromBlob: vi.fn(),
  prepareImage: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (e: { payload: unknown }) => void) => {
      hoisted.handler = cb;
      return Promise.resolve(hoisted.unlisten);
    },
  }),
}));
vi.mock("sonner", () => ({ toast: hoisted.toast }));
vi.mock("@/lib/api", () => ({ api: { boards: { readDroppedFile: hoisted.readDroppedFile } } }));
vi.mock("@excalidraw/excalidraw", () => ({
  // converte o "esqueleto" em elementos com id, como o Excalidraw faz
  convertToExcalidrawElements: (skeletons: Record<string, unknown>[]) => skeletons.map((s, i) => ({ ...s, id: `el-${i}-${s.fileId}` })),
  loadLibraryFromBlob: hoisted.loadLibraryFromBlob,
  // cena = janela, deslocada (100, 50): dá para conferir que o ponto convertido é o usado
  viewportCoordsToSceneCoords: ({ clientX, clientY }: { clientX: number; clientY: number }) => ({ x: clientX + 100, y: clientY + 50 }),
}));
vi.mock("./board-drop-utils", async (orig) => ({ ...(await orig<typeof import("./board-drop-utils")>()), prepareImage: hoisted.prepareImage }));

import { insertDroppedFiles, useBoardFileDrop } from "./use-board-file-drop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeApi() {
  const scene: { id: string; [k: string]: unknown }[] = [{ id: "existente" }];
  return {
    addFiles: vi.fn(),
    updateScene: vi.fn(),
    updateLibrary: vi.fn(async () => undefined),
    getSceneElements: () => scene,
    getAppState: () => ({}),
  };
}

const bytes = (...n: number[]) => new Uint8Array(n).buffer as ArrayBuffer;

beforeEach(() => {
  hoisted.handler = null;
  hoisted.unlisten.mockClear();
  hoisted.toast.success.mockClear();
  hoisted.toast.error.mockClear();
  hoisted.readDroppedFile.mockReset();
  hoisted.loadLibraryFromBlob.mockReset();
  hoisted.prepareImage.mockReset().mockResolvedValue({ dataURL: "data:image/png;base64,AA", mimeType: "image/png", width: 1000, height: 500 });
});

describe("insertDroppedFiles", () => {
  it("insere a imagem centralizada no ponto, reduzida, com o id do conteúdo e já selecionada", async () => {
    const api = fakeApi();
    hoisted.readDroppedFile.mockResolvedValue(new TextEncoder().encode("abc").buffer);
    await insertDroppedFiles(api as never, ["C:\\fotos\\a.png"], { x: 1000, y: 500 });

    expect(hoisted.readDroppedFile).toHaveBeenCalledWith("C:\\fotos\\a.png");
    const [file] = api.addFiles.mock.calls[0][0];
    expect(file).toMatchObject({ id: "a9993e364706816aba3e25717850c26c9cd0d89d", mimeType: "image/png", dataURL: "data:image/png;base64,AA" });

    const { elements, appState } = api.updateScene.mock.calls[0][0];
    expect(elements).toHaveLength(2); // a cena existente + a imagem
    expect(elements[0].id).toBe("existente");
    // 1000x500 cabe em 480x240; centralizada em (1000, 500)
    expect(elements[1]).toMatchObject({ type: "image", status: "saved", fileId: file.id, width: 480, height: 240, x: 760, y: 380 });
    expect(appState.selectedElementIds).toEqual({ [elements[1].id]: true });
    expect(hoisted.toast.error).not.toHaveBeenCalled();
  });

  it("espaça as imagens soltas de uma vez e grava a cena uma só vez", async () => {
    const api = fakeApi();
    hoisted.readDroppedFile.mockResolvedValueOnce(bytes(1)).mockResolvedValueOnce(bytes(2));
    await insertDroppedFiles(api as never, ["a.png", "b.JPG"], { x: 0, y: 0 });
    expect(api.addFiles).toHaveBeenCalledTimes(2);
    expect(api.updateScene).toHaveBeenCalledOnce();
    const els = api.updateScene.mock.calls[0][0].elements;
    expect(els[2].x - els[1].x).toBe(24);
    expect(els[2].y - els[1].y).toBe(24);
  });

  it("importa um .excalidrawlib para a biblioteca, sem mexer na cena", async () => {
    const api = fakeApi();
    hoisted.readDroppedFile.mockResolvedValue(new TextEncoder().encode('{"type":"excalidrawlib"}').buffer);
    hoisted.loadLibraryFromBlob.mockResolvedValue([{ id: "x" }, { id: "y" }]);
    await insertDroppedFiles(api as never, ["lib.excalidrawlib"], { x: 0, y: 0 });
    expect(api.updateLibrary).toHaveBeenCalledWith({ libraryItems: [{ id: "x" }, { id: "y" }], merge: true, openLibraryMenu: true });
    expect(hoisted.toast.success).toHaveBeenCalledWith("2 itens importados para a biblioteca");
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(api.addFiles).not.toHaveBeenCalled();
  });

  it("recusa tipos não suportados sem nem ler o arquivo", async () => {
    const api = fakeApi();
    await insertDroppedFiles(api as never, ["programa.exe", "nota.txt"], { x: 0, y: 0 });
    expect(hoisted.readDroppedFile).not.toHaveBeenCalled();
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(hoisted.toast.error).toHaveBeenCalledTimes(1); // um aviso só, não um por arquivo
  });

  it("uma falha não impede os outros arquivos e o erro cita o nome do arquivo", async () => {
    const api = fakeApi();
    hoisted.readDroppedFile.mockRejectedValueOnce("arquivo grande demais").mockResolvedValueOnce(bytes(7));
    await insertDroppedFiles(api as never, ["C:\\x\\ruim.png", "C:\\x\\boa.png"], { x: 0, y: 0 });
    expect(hoisted.toast.error).toHaveBeenCalledWith(expect.stringContaining("ruim.png"));
    expect(api.updateScene.mock.calls[0][0].elements).toHaveLength(2);
  });
});

describe("useBoardFileDrop", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = host = null;
  });

  function Probe({ api }: { api: ReturnType<typeof fakeApi> | null }) {
    const ref = useRef<HTMLDivElement>(null);
    const { dragging } = useBoardFileDrop(api as never, ref);
    return (
      <div
        ref={(el) => {
          ref.current = el;
          // o quadro ocupa x de 200 a 1000 e y de 100 a 700 (px lógicos)
          if (el) el.getBoundingClientRect = () => ({ left: 200, right: 1000, top: 100, bottom: 700 }) as DOMRect;
        }}
        data-testid="quadro"
      >
        {dragging ? "arrastando" : "parado"}
      </div>
    );
  }

  async function mount(api: ReturnType<typeof fakeApi> | null = fakeApi()) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<Probe api={api} />));
    return { api, text: () => host!.textContent };
  }

  const fire = (payload: unknown) => act(async () => hoisted.handler!({ payload }));

  it("destaca a área só quando o arquivo está sobre o quadro e limpa ao sair", async () => {
    const { text } = await mount();
    await fire({ type: "enter", paths: [], position: { x: 500, y: 300 } });
    expect(text()).toBe("arrastando");
    await fire({ type: "over", position: { x: 50, y: 300 } }); // sobre a sidebar
    expect(text()).toBe("parado");
    await fire({ type: "over", position: { x: 500, y: 300 } });
    expect(text()).toBe("arrastando");
    await fire({ type: "leave" });
    expect(text()).toBe("parado");
  });

  it("ao soltar sobre o quadro, insere no ponto convertido (px físicos viram lógicos)", async () => {
    const { api } = await mount();
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    hoisted.readDroppedFile.mockResolvedValue(bytes(9));
    await fire({ type: "drop", paths: ["a.png"], position: { x: 1000, y: 600 } }); // lógico: (500, 300)
    await vi.waitFor(() => expect(api!.updateScene).toHaveBeenCalled());
    // cena = lógico + (100, 50) = (600, 350); imagem 480x240 centralizada
    expect(api!.updateScene.mock.calls[0][0].elements[1]).toMatchObject({ x: 360, y: 230 });
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  });

  it("soltar fora do quadro (por exemplo na sidebar) não faz nada", async () => {
    const { api } = await mount();
    await fire({ type: "drop", paths: ["a.png"], position: { x: 50, y: 300 } });
    expect(hoisted.readDroppedFile).not.toHaveBeenCalled();
    expect(api!.updateScene).not.toHaveBeenCalled();
  });

  it("não escuta antes de o Excalidraw estar pronto e solta o ouvinte ao desmontar", async () => {
    await mount(null);
    expect(hoisted.handler).toBeNull();
    act(() => root?.unmount());
    root = null;

    await mount(fakeApi());
    expect(hoisted.handler).not.toBeNull();
    act(() => root?.unmount());
    root = null;
    await vi.waitFor(() => expect(hoisted.unlisten).toHaveBeenCalled());
  });
});

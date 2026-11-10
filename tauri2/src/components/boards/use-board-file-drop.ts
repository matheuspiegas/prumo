import { convertToExcalidrawElements, loadLibraryFromBlob, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState, type RefObject } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { dropKind, fileIdFromBytes, fitSize, imageMime, prepareImage } from "./board-drop-utils";

/** Distância entre imagens soltas de uma vez (em unidades do quadro), para não ficarem empilhadas. */
const STAGGER = 24;

/** Importa o texto de um `.excalidrawlib` para a biblioteca do quadro. Devolve quantos itens entraram. */
export async function importLibraryText(excalidrawApi: ExcalidrawImperativeAPI, text: string): Promise<number> {
  const items = await loadLibraryFromBlob(new Blob([text], { type: "application/json" }));
  if (items.length === 0) throw new Error("essa biblioteca não tem nenhum item");
  await excalidrawApi.updateLibrary({ libraryItems: items, merge: true, openLibraryMenu: true });
  return items.length;
}

const libraryToast = (n: number) => (n === 1 ? "1 item importado para a biblioteca" : `${n} itens importados para a biblioteca`);

/**
 * Trata os arquivos soltos no quadro: imagens entram como elementos de imagem, no ponto onde foram soltas
 * (`point` já em coordenadas do quadro); `.excalidrawlib` é importado para a biblioteca; o resto é recusado.
 */
export async function insertDroppedFiles(excalidrawApi: ExcalidrawImperativeAPI, paths: string[], point: { x: number; y: number }) {
  const created: ReturnType<typeof convertToExcalidrawElements> = [];
  let unsupported = 0;

  for (const path of paths) {
    const kind = dropKind(path);
    if (!kind) {
      unsupported++;
      continue;
    }
    try {
      const bytes = await api.boards.readDroppedFile(path);
      if (kind === "library") {
        const n = await importLibraryText(excalidrawApi, new TextDecoder().decode(bytes));
        toast.success(libraryToast(n));
        continue;
      }
      const prepared = await prepareImage(bytes, imageMime(path));
      const id = await fileIdFromBytes(bytes);
      const file = { id, dataURL: prepared.dataURL, mimeType: prepared.mimeType, created: Date.now() } as unknown as BinaryFileData;
      excalidrawApi.addFiles([file]);
      const { width, height } = fitSize(prepared.width, prepared.height);
      const offset = created.length * STAGGER;
      created.push(
        ...convertToExcalidrawElements([
          { type: "image", fileId: id, status: "saved", x: point.x - width / 2 + offset, y: point.y - height / 2 + offset, width, height } as never,
        ]),
      );
    } catch (e) {
      toast.error(`Não foi possível inserir ${path.split(/[\\/]/).pop()}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (created.length) {
    excalidrawApi.updateScene({
      elements: [...excalidrawApi.getSceneElements(), ...created],
      appState: { selectedElementIds: Object.fromEntries(created.map((el) => [el.id, true])) } as never,
    });
  }
  if (unsupported) {
    toast.error("No quadro só dá para soltar imagens (png, jpg, gif, webp, svg, bmp) e bibliotecas .excalidrawlib.");
  }
}

/**
 * Liga o arrastar-e-soltar de arquivos ao quadro enquanto ele está aberto. O Tauri entrega só os caminhos e a
 * posição (em pixels físicos, relativa à janela). Devolve `dragging` para o quadro destacar a área de soltar.
 */
export function useBoardFileDrop(excalidrawApi: ExcalidrawImperativeAPI | null, containerRef: RefObject<HTMLElement | null>) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!excalidrawApi) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    /** Posição do evento em coordenadas da janela (px lógicos) e se cai dentro do quadro. */
    const locate = (pos: { x: number; y: number }) => {
      const dpr = window.devicePixelRatio || 1;
      const clientX = pos.x / dpr;
      const clientY = pos.y / dpr;
      const r = containerRef.current?.getBoundingClientRect();
      const inside = !!r && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
      return { clientX, clientY, inside };
    };

    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "leave") return setDragging(false);
        const { clientX, clientY, inside } = locate(p.position);
        if (p.type === "enter" || p.type === "over") return setDragging(inside);
        // drop
        setDragging(false);
        if (!inside) return;
        const scene = viewportCoordsToSceneCoords({ clientX, clientY }, excalidrawApi.getAppState());
        void insertDroppedFiles(excalidrawApi, p.paths, scene);
      })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)));

    return () => {
      cancelled = true;
      unlisten?.();
      setDragging(false);
    };
  }, [excalidrawApi, containerRef]);

  return { dragging };
}

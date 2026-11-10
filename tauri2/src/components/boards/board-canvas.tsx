import "./excalidraw-env"; // PRECISA vir antes do pacote: define window.EXCALIDRAW_ASSET_PATH (fontes offline)
import {
  Excalidraw,
  FONT_FAMILY,
  MainMenu,
  exportToBlob,
  getNonDeletedElements,
  getSceneVersion,
  restoreAppState,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { open } from "@tauri-apps/plugin-dialog";
import { LibraryBig } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import "./board-canvas.css";
import { mergeLibraries, parseUserLibrary, serializeUserLibrary } from "./library-utils";
import { PRUMO_LIBRARY_ITEMS } from "./prumo-library";
import { useBoardAutosave } from "./use-board-autosave";
import { importLibraryText, useBoardFileDrop } from "./use-board-file-drop";

export type BoardCanvasProps = {
  boardId: number;
  /** Chamado quando o estado de gravação muda (para o indicador "Salvo" da barra do quadro). */
  onSaveState?: (state: "saving" | "saved" | "error") => void;
};

type Snapshot = { elements: readonly OrderedExcalidrawElement[]; appState: AppState; files: BinaryFiles };

/** Lado maior da miniatura, em px. */
const THUMBNAIL_SIZE = 320;

// Estável (não recriar a cada render). "Abrir"/"Salvar em disco" não fazem sentido no app desktop,
// e o tema é o do app (sem o botão de alternar tema do Excalidraw).
const UI_OPTIONS = { canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false } } as const;

type Loaded = { initialData: ExcalidrawInitialDataState; userLibraryJson: string; libraryReadable: boolean };

async function loadBoard(boardId: number): Promise<Loaded> {
  const [sceneText, libraryText] = await Promise.all([
    api.boards.read(boardId),
    api.boards.readLibrary().then(
      (text) => ({ ok: true as const, text }),
      (e) => {
        console.error("Falha ao ler a biblioteca de formas", e);
        return { ok: false as const, text: "" };
      },
    ),
  ]);
  const userItems = parseUserLibrary(libraryText.text);
  const data = sceneText ? (JSON.parse(sceneText) as { elements?: unknown[]; appState?: Record<string, unknown>; files?: BinaryFiles }) : null;
  const elements = restoreElements((data?.elements ?? []) as never, null, { refreshDimensions: false });
  const appState = restoreAppState((data?.appState ?? {}) as never, null);
  // Texto novo em Nunito, a menos que o quadro já tenha uma fonte escolhida pelo usuário.
  if (data?.appState?.currentItemFontFamily == null) appState.currentItemFontFamily = FONT_FAMILY.Nunito;
  return {
    initialData: {
      elements,
      appState,
      files: data?.files ?? {},
      libraryItems: mergeLibraries(PRUMO_LIBRARY_ITEMS, userItems),
      scrollToContent: elements.length > 0,
    },
    userLibraryJson: serializeUserLibrary(userItems),
    libraryReadable: libraryText.ok,
  };
}

/** Quadro infinito (Excalidraw) com salvamento automático. Carregado com React.lazy pela tela de quadros. */
export function BoardCanvas({ boardId, onSaveState }: BoardCanvasProps) {
  const [state, setState] = useState<{ id: number; loaded?: Loaded; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBoard(boardId).then(
      (loaded) => !cancelled && setState({ id: boardId, loaded }),
      (e) => !cancelled && setState({ id: boardId, error: String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  if (!state || state.id !== boardId) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Carregando quadro…</div>;
  }
  if (!state.loaded) {
    // Sem montar o canvas, nada é gravado por cima do arquivo original.
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-destructive">
        Não foi possível abrir este quadro. {state.error}
      </div>
    );
  }
  return <CanvasInner key={boardId} boardId={boardId} loaded={state.loaded} onSaveState={onSaveState} />;
}

function CanvasInner({ boardId, loaded, onSaveState }: BoardCanvasProps & { loaded: Loaded }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [importing, setImporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Arrastar imagem ou .excalidrawlib do Explorer para o quadro (o Tauri só entrega os caminhos).
  const { dragging } = useBoardFileDrop(excalidrawApi, containerRef);

  const autosave = useBoardAutosave<Snapshot>({
    boardId,
    onSaveState,
    getVersion: (s) => getSceneVersion(s.elements),
    serialize: (s) => serializeAsJSON(s.elements, s.appState, s.files, "local"),
    makeThumbnail: async (s) => {
      const elements = getNonDeletedElements(s.elements);
      if (elements.length === 0) return null;
      const blob = await exportToBlob({
        elements,
        appState: { ...s.appState, exportBackground: true, exportWithDarkMode: themeRef.current === "dark" },
        files: s.files,
        maxWidthOrHeight: THUMBNAIL_SIZE,
        mimeType: "image/png",
      });
      return blob.arrayBuffer();
    },
  });

  // Biblioteca: grava só os itens do usuário, e só se a leitura inicial funcionou (senão um erro de
  // leitura faria a primeira gravação apagar as bibliotecas importadas).
  const lastLibraryJson = useRef(loaded.userLibraryJson);
  const onLibraryChange = useCallback(
    (items: Parameters<typeof mergeLibraries>[1]) => {
      if (!loaded.libraryReadable) return;
      const json = serializeUserLibrary(items);
      if (json === lastLibraryJson.current) return;
      lastLibraryJson.current = json;
      api.boards.writeLibrary(json).catch((e) => toast.error(`Não foi possível salvar a biblioteca: ${e}`));
    },
    [loaded.libraryReadable],
  );

  const importLibrary = useCallback(async () => {
    if (!excalidrawApi || importing) return;
    setImporting(true);
    try {
      const path = await open({
        multiple: false,
        title: "Importar biblioteca do Excalidraw",
        filters: [{ name: "Biblioteca do Excalidraw", extensions: ["excalidrawlib", "json"] }],
      });
      if (!path) return;
      const text = await api.boards.readTextFile(path);
      const n = await importLibraryText(excalidrawApi, text);
      toast.success(n === 1 ? "1 item importado para a biblioteca" : `${n} itens importados para a biblioteca`);
    } catch (e) {
      toast.error(`Não foi possível importar a biblioteca: ${e instanceof Error ? e.message : e}`);
    } finally {
      setImporting(false);
    }
  }, [excalidrawApi, importing]);

  const topRightUI = useMemo(
    () => () => (
      <button type="button" className="prumo-import-library" onClick={importLibrary} disabled={!excalidrawApi || importing} title="Importar um arquivo .excalidrawlib">
        <LibraryBig aria-hidden />
        Importar biblioteca
      </button>
    ),
    [importLibrary, excalidrawApi, importing],
  );

  return (
    <div ref={containerRef} className={dragging ? "prumo-board prumo-board--drop" : "prumo-board"}>
      <Excalidraw
        initialData={loaded.initialData}
        excalidrawAPI={setExcalidrawApi}
        onChange={(elements, appState, files) => autosave.onChange({ elements, appState, files })}
        onLibraryChange={onLibraryChange}
        theme={theme}
        langCode="pt-BR"
        handleKeyboardGlobally={false}
        UIOptions={UI_OPTIONS}
        renderTopRightUI={topRightUI}
      >
        {/* Menu enxuto: sem abrir/salvar em disco nem links sociais (abririam fora do app). */}
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}

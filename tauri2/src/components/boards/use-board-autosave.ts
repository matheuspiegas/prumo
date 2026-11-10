import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";

export type BoardSaveState = "saving" | "saved" | "error";

export type AutosaveOptions<S> = {
  boardId: number;
  /** Versão da cena (ex.: `getSceneVersion(elements)`): só grava se mudou de fato. */
  getVersion: (snapshot: S) => number;
  /** Cena em JSON `.excalidraw` (ex.: `serializeAsJSON(elements, appState, files, "local")`). */
  serialize: (snapshot: S) => string;
  /** PNG da miniatura, ou `null` para pular (quadro vazio). */
  makeThumbnail?: (snapshot: S) => Promise<ArrayBuffer | null>;
  onSaveState?: (state: BoardSaveState) => void;
  /** Espera após a última alteração antes de gravar a cena. */
  delayMs?: number;
  /** Espera após a última alteração antes de gerar a miniatura. */
  thumbnailDelayMs?: number;
};

// Gravações do mesmo quadro são encadeadas, para nunca chegarem fora de ordem ao backend
// (ex.: trocar A -> B -> A rapidamente com uma gravação de A ainda em andamento).
const writeChains = new Map<number, Promise<unknown>>();
function enqueueWrite(id: number, job: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(id) ?? Promise.resolve();
  const next = prev.then(job, job);
  writeChains.set(id, next);
  const cleanup = () => {
    if (writeChains.get(id) === next) writeChains.delete(id);
  };
  next.then(cleanup, cleanup);
  return next;
}

type Session<S> = { id: number; onChange: (s: S) => void; flush: () => void; dispose: () => void };

function createSession<S>(id: number, optsRef: { current: AutosaveOptions<S> }): Session<S> {
  let seen: number | null = null; // última versão vista (carregada, pendente ou gravada)
  let pending: S | null = null;
  let latest: S | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let thumbTimer: ReturnType<typeof setTimeout> | undefined;
  let thumbDirty = false;
  let inflight = 0;
  let disposed = false;

  const notify = (state: BoardSaveState) => {
    if (!disposed) optsRef.current.onSaveState?.(state);
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const snapshot = pending;
    pending = null;
    inflight += 1;
    notify("saving");
    void enqueueWrite(id, async () => {
      await api.boards.write(id, optsRef.current.serialize(snapshot));
    }).then(
      () => {
        inflight -= 1;
        if (inflight === 0 && !pending) notify("saved");
      },
      (e) => {
        inflight -= 1;
        seen = Number.NaN; // a próxima alteração (qualquer versão) tenta gravar de novo
        console.error("Falha ao gravar o quadro", id, e);
        notify("error");
      },
    );
  };

  const flushThumbnail = () => {
    clearTimeout(thumbTimer);
    thumbTimer = undefined;
    const make = optsRef.current.makeThumbnail;
    if (!thumbDirty || !latest || !make) return;
    thumbDirty = false;
    make(latest)
      .then((png) => (png ? api.boards.writeThumbnail(id, png) : undefined))
      .catch((e) => console.warn("Falha ao gerar a miniatura do quadro", id, e));
  };

  return {
    id,
    onChange(s) {
      if (disposed) return;
      const v = optsRef.current.getVersion(s);
      latest = s;
      if (seen === null) {
        // Primeira chamada: é a cena recém-carregada, nada a gravar.
        seen = v;
        return;
      }
      if (v === seen) return; // só mudou aparência (rolagem, zoom, seleção...), a cena é a mesma
      seen = v;
      pending = s;
      thumbDirty = true;
      notify("saving");
      clearTimeout(timer);
      timer = setTimeout(flush, optsRef.current.delayMs ?? 1000);
      clearTimeout(thumbTimer);
      thumbTimer = setTimeout(flushThumbnail, optsRef.current.thumbnailDelayMs ?? 4000);
    },
    flush() {
      flush();
      flushThumbnail();
    },
    dispose() {
      flush();
      flushThumbnail();
      disposed = true;
    },
  };
}

/**
 * Salva sozinho a cena de um quadro: debounce em `onChange`, só grava se a cena mudou, força a gravação
 * ao desmontar, ao trocar de `boardId` e em `visibilitychange`/`pagehide`, e gera a miniatura com
 * um debounce maior. Passe o `onChange` retornado ao Excalidraw (use `key={boardId}` no componente).
 */
export function useBoardAutosave<S>(opts: AutosaveOptions<S>) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const sessionRef = useRef<Session<S> | null>(null);
  const { boardId } = opts;

  useEffect(() => {
    const flushNow = () => sessionRef.current?.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [boardId]);

  const onChange = useCallback(
    (snapshot: S) => {
      if (!sessionRef.current || sessionRef.current.id !== boardId) {
        sessionRef.current?.dispose();
        sessionRef.current = createSession(boardId, optsRef);
      }
      sessionRef.current.onChange(snapshot);
    },
    [boardId],
  );

  const flush = useCallback(() => sessionRef.current?.flush(), []);
  return { onChange, flush };
}

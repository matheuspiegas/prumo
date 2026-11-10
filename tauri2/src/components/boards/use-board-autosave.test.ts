// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** renderHook mínimo (o projeto não usa @testing-library). */
function renderHook<R, P>(hook: (p: P) => R, { initialProps }: { initialProps?: P } = {}) {
  const result = { current: undefined as R };
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe({ p }: { p: P }) {
    result.current = hook(p);
    return null;
  }
  const render = (p: P) => act(() => root.render(createElement(Probe, { p })));
  render(initialProps as P);
  return { result, rerender: (p: P) => render(p), unmount: () => act(() => root.unmount()) };
}

const write = vi.fn((_id: number, _scene: string) => Promise.resolve());
const writeThumbnail = vi.fn((_id: number, _png: ArrayBuffer) => Promise.resolve());
vi.mock("@/lib/api", () => ({
  api: { boards: { write: (id: number, s: string) => write(id, s), writeThumbnail: (id: number, p: ArrayBuffer) => writeThumbnail(id, p) } },
}));

import { useBoardAutosave } from "./use-board-autosave";

type Snap = { v: number };
const base = {
  getVersion: (s: Snap) => s.v,
  serialize: (s: Snap) => JSON.stringify(s),
  makeThumbnail: async () => new ArrayBuffer(4),
};

beforeEach(() => {
  vi.useFakeTimers();
  write.mockClear();
  writeThumbnail.mockClear();
});
afterEach(() => vi.useRealTimers());

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("useBoardAutosave", () => {
  it("ignora a cena inicial e grava uma vez após o debounce de 1 s", async () => {
    const onSaveState = vi.fn();
    const { result } = renderHook(() => useBoardAutosave<Snap>({ ...base, boardId: 1, onSaveState }));
    act(() => result.current.onChange({ v: 5 })); // cena carregada
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(write).not.toHaveBeenCalled();

    act(() => result.current.onChange({ v: 6 }));
    act(() => result.current.onChange({ v: 7 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(write).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(1, JSON.stringify({ v: 7 }));
    expect(onSaveState.mock.calls.map((c) => c[0])).toEqual(["saving", "saving", "saving", "saved"]);
  });

  it("não regrava uma cena igual", async () => {
    const { result } = renderHook(() => useBoardAutosave<Snap>({ ...base, boardId: 1 }));
    act(() => result.current.onChange({ v: 1 }));
    act(() => result.current.onChange({ v: 2 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    act(() => result.current.onChange({ v: 2 })); // só mudou o appState
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("força a gravação ao desmontar", async () => {
    const { result, unmount } = renderHook(() => useBoardAutosave<Snap>({ ...base, boardId: 3 }));
    act(() => result.current.onChange({ v: 1 }));
    act(() => result.current.onChange({ v: 2 }));
    unmount();
    await settle();
    expect(write).toHaveBeenCalledWith(3, JSON.stringify({ v: 2 }));
    // o temporizador antigo não grava de novo
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("força a gravação em visibilitychange (oculto) e pagehide", async () => {
    const { result } = renderHook(() => useBoardAutosave<Snap>({ ...base, boardId: 1 }));
    act(() => result.current.onChange({ v: 1 }));
    act(() => result.current.onChange({ v: 2 }));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
    act(() => result.current.onChange({ v: 3 }));
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    await settle();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(1, JSON.stringify({ v: 3 }));
  });

  it("ao trocar de boardId grava o pendente no quadro antigo", async () => {
    const { result, rerender } = renderHook(({ id }) => useBoardAutosave<Snap>({ ...base, boardId: id }), { initialProps: { id: 1 } });
    act(() => result.current.onChange({ v: 1 }));
    act(() => result.current.onChange({ v: 2 }));
    rerender({ id: 2 });
    await settle();
    expect(write).toHaveBeenCalledWith(1, JSON.stringify({ v: 2 }));
    // o quadro novo começa do zero: a primeira cena é só a carga
    act(() => result.current.onChange({ v: 10 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(write).toHaveBeenCalledTimes(1);
    act(() => result.current.onChange({ v: 11 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(write).toHaveBeenLastCalledWith(2, JSON.stringify({ v: 11 }));
  });

  it("reporta erro e tenta de novo na próxima alteração", async () => {
    const onSaveState = vi.fn();
    write.mockRejectedValueOnce(new Error("disco cheio"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useBoardAutosave<Snap>({ ...base, boardId: 1, onSaveState }));
    act(() => result.current.onChange({ v: 1 }));
    act(() => result.current.onChange({ v: 2 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onSaveState).toHaveBeenLastCalledWith("error");
    act(() => result.current.onChange({ v: 2 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(write).toHaveBeenCalledTimes(2);
    expect(onSaveState).toHaveBeenLastCalledWith("saved");
  });

  it("gera a miniatura com debounce de 4 s e pula quando não há PNG", async () => {
    const makeThumbnail = vi.fn<() => Promise<ArrayBuffer | null>>(async () => new ArrayBuffer(8));
    const { result } = renderHook(() => useBoardAutosave<Snap>({ ...base, boardId: 1, makeThumbnail }));
    act(() => result.current.onChange({ v: 1 }));
    act(() => result.current.onChange({ v: 2 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3999); });
    expect(writeThumbnail).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(writeThumbnail).toHaveBeenCalledTimes(1);

    makeThumbnail.mockResolvedValueOnce(null);
    act(() => result.current.onChange({ v: 3 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(makeThumbnail).toHaveBeenCalledTimes(2);
    expect(writeThumbnail).toHaveBeenCalledTimes(1);
  });
});

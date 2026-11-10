import { describe, expect, it } from "vitest";
import type { LibraryItems } from "@excalidraw/excalidraw/types";
import { mergeLibraries, parseUserLibrary, serializeUserLibrary, userLibraryItems } from "./library-utils";

const item = (id: string) => ({ id, status: "unpublished", elements: [], created: 1 }) as unknown as LibraryItems[number];

describe("library-utils", () => {
  it("filtra só os itens do usuário", () => {
    expect(userLibraryItems([item("prumo-a"), item("x"), item("y")]).map((i) => i.id)).toEqual(["x", "y"]);
  });

  it("serializa no formato excalidrawlib v2 sem os itens embutidos", () => {
    const json = JSON.parse(serializeUserLibrary([item("prumo-a"), item("x")]));
    expect(json).toMatchObject({ type: "excalidrawlib", version: 2, source: "prumo" });
    expect(json.libraryItems.map((i: { id: string }) => i.id)).toEqual(["x"]);
  });

  it("lê o JSON gravado e tolera vazio ou lixo", () => {
    expect(parseUserLibrary(serializeUserLibrary([item("x")])).map((i) => i.id)).toEqual(["x"]);
    expect(parseUserLibrary("")).toEqual([]);
    expect(parseUserLibrary("[]")).toEqual([]);
    expect(parseUserLibrary("nao é json")).toEqual([]);
    expect(parseUserLibrary('{"libraryItems": 3}')).toEqual([]);
  });

  it("mescla embutidos primeiro, sem repetir ids nem deixar o usuário sobrescrever embutidos", () => {
    const merged = mergeLibraries([item("prumo-a")], [item("prumo-a"), item("x"), item("x"), item("y")]);
    expect(merged.map((i) => i.id)).toEqual(["prumo-a", "x", "y"]);
  });
});

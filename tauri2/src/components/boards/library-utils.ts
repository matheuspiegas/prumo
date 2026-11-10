import type { LibraryItems } from "@excalidraw/excalidraw/types";

/** Prefixo dos ids dos itens da biblioteca embutida "Prumo" (esses nunca são gravados em library.json). */
export const PRUMO_ITEM_PREFIX = "prumo-";

export const isBuiltinItem = (item: { id: string }) => item.id.startsWith(PRUMO_ITEM_PREFIX);

/** Só os itens do usuário (importados ou criados por ele). */
export function userLibraryItems(items: LibraryItems): LibraryItems {
  return items.filter((i) => !isBuiltinItem(i));
}

/** Itens da biblioteca do usuário a partir do JSON gravado; tolera vazio, lixo e formato antigo. */
export function parseUserLibrary(json: string | null | undefined): LibraryItems {
  if (!json || !json.trim()) return [];
  try {
    const data: unknown = JSON.parse(json);
    const list = Array.isArray(data) ? data : (data as { libraryItems?: unknown } | null)?.libraryItems;
    if (!Array.isArray(list)) return [];
    // Só aceita o formato v2 (itens com id e elements); formatos antigos (arrays de elementos) são ignorados.
    return list.filter(
      (i): i is LibraryItems[number] => !!i && typeof i === "object" && typeof i.id === "string" && Array.isArray(i.elements),
    );
  } catch {
    return [];
  }
}

/** Embutidos primeiro, depois os do usuário (sem repetir ids nem sobrescrever os embutidos). */
export function mergeLibraries(builtin: LibraryItems, user: LibraryItems): LibraryItems {
  const seen = new Set(builtin.map((i) => i.id));
  const out = [...builtin];
  for (const item of userLibraryItems(user)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** JSON `.excalidrawlib` (v2) só com os itens do usuário. */
export function serializeUserLibrary(items: LibraryItems): string {
  return JSON.stringify({ type: "excalidrawlib", version: 2, source: "prumo", libraryItems: userLibraryItems(items) });
}

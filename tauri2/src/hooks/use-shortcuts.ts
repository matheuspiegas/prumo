import { useEffect, useRef } from "react";

export type ShortcutHandlers = {
  /** Desliga todos os atalhos (ex.: fora da lista de tarefas). */
  enabled: boolean;
  onNew: () => void;
  onFocusSearch: () => void;
  onToggleSelected: () => void;
  onMove: (delta: 1 | -1) => void;
  onOpenSelected: () => void;
  onDeleteSelected: () => void;
  onEscape: () => void;
  onHelp: () => void;
};

/** `true` em macOS/iOS: usamos ⌘ no lugar de Ctrl. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

function typing(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** Interativos que já tratam Espaço/Enter sozinhos. */
function interactive(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && !!el.closest("button, a, [role=checkbox], [role=switch], [role=combobox]");
}

/** Atalhos globais do app. Ignora digitação em campos e qualquer diálogo aberto. */
export function useShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      if (!h.enabled || e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        h.onFocusSearch();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target)) return;

      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      switch (e.key) {
        case "n":
        case "N":
          return act(h.onNew);
        case "/":
          return act(h.onFocusSearch);
        case "?":
          return act(h.onHelp);
        case "ArrowDown":
        case "j":
        case "J":
          return act(() => h.onMove(1));
        case "ArrowUp":
        case "k":
        case "K":
          return act(() => h.onMove(-1));
        case " ":
          if (!interactive(e.target)) act(h.onToggleSelected);
          return;
        case "Enter":
          if (!interactive(e.target)) act(h.onOpenSelected);
          return;
        case "Delete":
          return act(h.onDeleteSelected);
        case "Escape":
          return h.onEscape();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

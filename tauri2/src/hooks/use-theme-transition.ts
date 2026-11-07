import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "next-themes";

type Origin = { x: number; y: number };

/** Centro de um elemento (ponto de partida do círculo). */
export function centerOf(el: Element): Origin {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Troca de tema com um círculo que se expande a partir de `origin` (View Transitions API).
 * Sem suporte ou com "reduzir movimento", troca na hora, como antes.
 * O CSS que desliga a animação padrão do `root` está em index.css.
 */
export function useThemeTransition() {
  const { theme = "system", setTheme } = useTheme();

  const change = useCallback(
    (value: string, origin?: Origin) => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (typeof document.startViewTransition !== "function" || reduce || value === theme) {
        setTheme(value);
        return;
      }
      const x = origin?.x ?? window.innerWidth / 2;
      const y = origin?.y ?? window.innerHeight / 2;
      // Raio até o canto mais distante: o círculo precisa cobrir a janela inteira.
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const transition = document.startViewTransition(() => {
        // O next-themes aplica a classe no <html> ao mudar o estado: flushSync garante que isso
        // aconteça dentro do callback, antes de a "foto" nova ser tirada.
        flushSync(() => setTheme(value));
      });
      transition.ready
        .then(() => {
          document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 600, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
          );
        })
        .catch(() => {});
    },
    [setTheme, theme],
  );

  return { theme, change };
}

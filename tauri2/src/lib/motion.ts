import type { Transition, Variants } from "motion/react";

/** Molas e variants compartilhados para manter o movimento coerente no app. */
export const spring: Transition = { type: "spring", stiffness: 500, damping: 38, mass: 0.8 };
export const softSpring: Transition = { type: "spring", stiffness: 320, damping: 30 };
export const bouncy: Transition = { type: "spring", stiffness: 600, damping: 18 };

/** Contêiner da lista: só propaga os rótulos hidden/show para as linhas (cascata via `custom`). */
export const listVariants: Variants = { hidden: {}, show: {} };

/** Passo (s) e limite de linhas da entrada em cascata ao trocar de filtro. */
export const STAGGER_STEP = 0.03;
export const STAGGER_MAX = 12;

/** Linha da lista: desliza para dentro (custom = atraso em s); sai deslizando e encolhendo. */
export const rowVariants: Variants = {
  hidden: { opacity: 0, x: -16, scale: 0.98 },
  show: (delay: number = 0) => ({ opacity: 1, x: 0, scale: 1, transition: { ...spring, delay } }),
  exit: { opacity: 0, x: 40, scale: 0.92, transition: { duration: 0.2, ease: "easeIn" } },
};

/** Atraso (ms) entre a marcação de concluída e a saída da linha. */
export const DONE_EXIT_DELAY = 600;

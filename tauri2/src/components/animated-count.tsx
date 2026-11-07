import { AnimatePresence, motion } from "motion/react";
import { bouncy, DUR_FAST } from "@/lib/motion";

/** Número que "rola" na vertical ao mudar (sobe se aumentou, desce se diminuiu) e dá um pequeno pop. */
export function AnimatedCount({ value, pulse }: { value: number; pulse?: number | string }) {
  return (
    <motion.span
      // Remonta só quando `pulse` muda: dispara o "pop" de chegada.
      key={pulse ?? "idle"}
      className="relative inline-flex overflow-hidden tabular-nums"
      animate={pulse !== undefined ? { scale: [1, 1.45, 1] } : undefined}
      transition={bouncy}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className="inline-block"
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{ duration: DUR_FAST }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

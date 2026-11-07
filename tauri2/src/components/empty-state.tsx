import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { bouncy, DUR_BASE, easeOut } from "@/lib/motion";

/** Estado vazio: o ícone entra com mola e flutua de leve; o texto surge em fade. */
export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-24 text-muted-foreground">
      <motion.div
        initial={{ opacity: 0, scale: 0.5, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ ...bouncy, delay: 0.1 }}
      >
        <motion.div
          animate={reduce ? undefined : { y: [0, -4, 0] }}
          transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity, delay: 0.8 }}
        >
          <Icon className="size-10" />
        </motion.div>
      </motion.div>
      <motion.p
        className="text-sm"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR_BASE, ease: easeOut, delay: 0.2 }}
      >
        {title}
      </motion.p>
      {hint && (
        <motion.p
          className="text-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DUR_BASE, delay: 0.3 }}
        >
          {hint}
        </motion.p>
      )}
    </div>
  );
}

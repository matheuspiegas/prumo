import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOut } from "@/lib/motion";

/** Texto que troca com crossfade vertical sutil quando `id` muda (sai rápido, entra logo em seguida). */
export function SwapText({
  id,
  as = "h1",
  className,
  children,
}: {
  id: string | number;
  as?: "h1" | "p";
  className?: string;
  children: ReactNode;
}) {
  const Tag = motion[as];
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Tag
        key={id}
        className={className}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: easeOut } }}
        exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
      >
        {children}
      </Tag>
    </AnimatePresence>
  );
}

/** Bloco que entra/sai com altura + fade (ex.: subtítulo, chip de filtro). */
export function Collapse({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto", transition: { duration: 0.2, ease: easeOut } }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

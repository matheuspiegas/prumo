import { motion } from "motion/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isMac } from "@/hooks/use-shortcuts";
import { DUR_BASE, easeOut } from "@/lib/motion";

const MOD = isMac ? "⌘" : "Ctrl";

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: "Tarefas",
    items: [
      [["N"], "Nova tarefa"],
      [["Espaço"], "Concluir a tarefa selecionada"],
      [["Enter"], "Abrir a tarefa selecionada"],
      [["Delete"], "Excluir a tarefa selecionada"],
    ],
  },
  {
    title: "Navegação",
    items: [
      [["↑", "↓"], "Mover a seleção (ou J / K)"],
      [[MOD, "K"], "Buscar (ou /)"],
      [["Esc"], "Limpar busca ou seleção"],
      [["?"], "Mostrar esta ajuda"],
    ],
  },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
        </DialogHeader>
        <motion.div
          className="flex flex-col gap-5"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } } }}
        >
          {GROUPS.map((g) => (
            <motion.section
              key={g.title}
              variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: DUR_BASE, ease: easeOut } } }}
              className="flex flex-col gap-2"
            >
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.title}</h3>
              {g.items.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-4 text-sm">
                  <span>{label}</span>
                  <span className="flex gap-1">
                    {keys.map((k) => (
                      <kbd key={k} className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </motion.section>
          ))}
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

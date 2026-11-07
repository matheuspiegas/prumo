import { useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { Mic, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TranscribingDots, VoiceWaves } from "@/components/voice-waves";
import type { VoiceState } from "@/hooks/use-voice";
import { prettyShortcut } from "@/lib/api";
import { bouncy, softSpring, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const content = {
  initial: { opacity: 0, y: 6, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6, filter: "blur(2px)" },
};

function Content({ state, level }: { state: VoiceState; level?: MotionValue<number> }) {
  if (state === "recording")
    return (
      <>
        <Square className="size-3.5 animate-pulse fill-current" />
        <VoiceWaves level={level} />
        <span>Parar e criar</span>
      </>
    );
  if (state === "transcribing")
    return (
      <>
        <TranscribingDots />
        <span>Transcrevendo…</span>
      </>
    );
  if (state === "interpreting")
    return (
      <>
        <motion.span
          className="flex text-primary"
          animate={{ scale: [1, 1.25, 1], rotate: [0, 15, 0], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="size-4" />
        </motion.span>
        <motion.span
          className="bg-[linear-gradient(110deg,var(--muted-foreground)_35%,var(--foreground)_50%,var(--muted-foreground)_65%)] bg-[length:250%_100%] bg-clip-text text-transparent"
          animate={{ backgroundPosition: ["120% 0", "-120% 0"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
        >
          Interpretando…
        </motion.span>
      </>
    );
  return (
    <>
      <Mic className="size-4" />
      <span>Voz</span>
    </>
  );
}

/** Anel atrás do botão que respira e se expande com o nível do microfone (só transform/opacity). */
function RecordingRing({ level }: { level?: MotionValue<number> }) {
  const fallback = useMotionValue(0);
  const l = level ?? fallback;
  const scale = useTransform(l, (v) => 1 + Math.min(1, Math.sqrt(Math.max(0, v)) * 1.5) * 0.14);
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute -inset-1 rounded-[10px] ring-2 ring-destructive/40"
      style={{ scale }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0.9, 0.35, 0.9] }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

export function VoiceButton({
  state,
  shortcut,
  onToggle,
  onCancel,
  level,
}: {
  state: VoiceState;
  shortcut: string;
  onToggle: () => void;
  onCancel: () => void;
  level?: MotionValue<number>;
}) {
  const [tip, setTip] = useState(false);
  const busy = state === "transcribing" || state === "interpreting";
  const recording = state === "recording";

  return (
    <div className="flex items-center">
      <Tooltip open={tip && state === "idle"} onOpenChange={setTip}>
        <TooltipTrigger
          render={
            <Button
              variant={recording ? "destructive" : "outline"}
              disabled={busy}
              onClick={onToggle}
              className={cn("relative disabled:opacity-100", busy && "text-muted-foreground")}
              nativeButton
              render={<motion.button layout style={{ borderRadius: 8 }} transition={spring} />}
            />
          }
        >
          <AnimatePresence initial={false}>{recording && <RecordingRing key="ring" level={level} />}</AnimatePresence>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={state}
              layout="position"
              className="flex items-center gap-1.5"
              variants={content}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={softSpring}
            >
              <Content state={state} level={level} />
            </motion.span>
          </AnimatePresence>
        </TooltipTrigger>
        <TooltipContent>Criar tarefa por voz ({prettyShortcut(shortcut)})</TooltipContent>
      </Tooltip>
      <AnimatePresence initial={false}>
        {recording && (
          <motion.div
            key="cancel"
            layout
            className="overflow-hidden"
            initial={{ width: 0, opacity: 0, scale: 0.6 }}
            animate={{ width: "auto", opacity: 1, scale: 1 }}
            exit={{ width: 0, opacity: 0, scale: 0.6 }}
            transition={bouncy}
          >
            <Button variant="ghost" size="icon" className="ml-1" onClick={onCancel} aria-label="Cancelar gravação">
              <X />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

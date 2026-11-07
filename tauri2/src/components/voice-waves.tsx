import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";
import { cn } from "@/lib/utils";

const BARS = [
  { gain: 0.55, speed: 5.1, phase: 0.0 },
  { gain: 0.8, speed: 6.3, phase: 1.3 },
  { gain: 0.95, speed: 4.7, phase: 2.1 },
  { gain: 1, speed: 7.2, phase: 0.6 },
  { gain: 0.95, speed: 5.6, phase: 3.0 },
  { gain: 0.8, speed: 6.8, phase: 1.8 },
  { gain: 0.55, speed: 4.9, phase: 2.7 },
];

function Bar({
  level,
  time,
  gain,
  speed,
  phase,
}: {
  level: MotionValue<number>;
  time: MotionValue<number>;
  gain: number;
  speed: number;
  phase: number;
}) {
  const scaleY = useTransform([level, time] as MotionValue<number>[], ([l, t]: number[]) => {
    const idle = 0.1 + 0.05 * Math.sin(t * 2 + phase);
    const wobble = 0.65 + 0.35 * Math.sin(t * speed + phase);
    const amp = Math.min(1, Math.sqrt(Math.max(0, l)) * 1.5) * gain * wobble;
    return Math.min(1, idle + amp * 0.9);
  });
  return <motion.span className="block h-full w-[3px] rounded-full bg-current" style={{ scaleY }} />;
}

/** Barras de áudio reagindo ao nível do microfone (sem re-render por frame). */
export function VoiceWaves({
  level,
  className,
}: {
  level?: MotionValue<number>;
  className?: string;
}) {
  const fallback = useMotionValue(0);
  const time = useMotionValue(0);
  useAnimationFrame((t) => time.set(t / 1000));
  return (
    <span aria-hidden className={cn("flex h-4 items-center gap-[2px]", className)}>
      {BARS.map((b, i) => (
        <Bar key={i} level={level ?? fallback} time={time} {...b} />
      ))}
    </span>
  );
}

/** Três pontos pulsando em sequência (transcrevendo). */
export function TranscribingDots() {
  return (
    <span aria-hidden className="flex h-4 items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block size-1.5 rounded-full bg-current"
          animate={{ y: [0, -4, 0], opacity: [0.35, 1, 0.35], scale: [0.85, 1.1, 0.85] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

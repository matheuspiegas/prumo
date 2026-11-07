import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Matiz estável (0-359) derivado do nome, sem diferenciar maiúsculas. */
export function tagHue(name: string) {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function tagStyle(name: string): CSSProperties {
  const h = tagHue(name);
  return { color: `oklch(0.55 0.14 ${h})`, backgroundColor: `oklch(0.65 0.14 ${h} / 0.15)` };
}

/** Chip discreto de tag, colorido de forma estável pelo nome. */
export function TagChip({ name, className, children }: { name: string; className?: string; children?: React.ReactNode }) {
  return (
    <span
      style={tagStyle(name)}
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-none whitespace-nowrap", className)}
    >
      #{name}
      {children}
    </span>
  );
}

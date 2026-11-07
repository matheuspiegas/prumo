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
export function TagChip({
  name,
  className,
  children,
  onClick,
}: {
  name: string;
  className?: string;
  children?: React.ReactNode;
  /** Quando informado, o chip vira um botão (ex.: filtrar pela tag). */
  onClick?: () => void;
}) {
  const cls = cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-none whitespace-nowrap", className);
  if (onClick) {
    return (
      <button
        type="button"
        style={tagStyle(name)}
        className={cn(cls, "cursor-pointer transition-opacity hover:opacity-70")}
        title={`Filtrar por #${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        #{name}
        {children}
      </button>
    );
  }
  return (
    <span style={tagStyle(name)} className={cls}>
      #{name}
      {children}
    </span>
  );
}

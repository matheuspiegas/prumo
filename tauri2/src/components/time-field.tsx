import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Hora opcional ("HH:MM") com botão para limpar. */
export function TimeField({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (time: string | null) => void;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="time"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Hora"
        className={className ?? "w-32"}
      />
      {value && (
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="Remover hora">
          <X />
        </Button>
      )}
    </div>
  );
}

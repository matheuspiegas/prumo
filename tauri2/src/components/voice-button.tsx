import { Loader2, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { VoiceState } from "@/hooks/use-voice";
import { prettyShortcut } from "@/lib/api";

export function VoiceButton({
  state,
  shortcut,
  onToggle,
  onCancel,
}: {
  state: VoiceState;
  shortcut: string;
  onToggle: () => void;
  onCancel: () => void;
}) {
  if (state === "transcribing" || state === "interpreting") {
    return (
      <Button variant="outline" disabled>
        <Loader2 data-icon="inline-start" className="animate-spin" />
        {state === "transcribing" ? "Transcrevendo…" : "Interpretando…"}
      </Button>
    );
  }
  if (state === "recording") {
    return (
      <div className="flex items-center gap-1">
        <Button variant="destructive" onClick={onToggle}>
          <Square data-icon="inline-start" className="animate-pulse fill-current" /> Parar e criar
        </Button>
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancelar gravação">
          <X />
        </Button>
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" onClick={onToggle} />}>
        <Mic data-icon="inline-start" /> Voz
      </TooltipTrigger>
      <TooltipContent>Criar tarefa por voz ({prettyShortcut(shortcut)})</TooltipContent>
    </Tooltip>
  );
}

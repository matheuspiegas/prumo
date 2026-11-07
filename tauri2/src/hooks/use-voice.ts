import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { api } from "@/lib/api";

export type VoiceState = "idle" | "recording" | "transcribing" | "interpreting";

/** Gravação por voz: botão e atalho global usam o mesmo fluxo. */
export function useVoice(onCreated: () => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const ref = useRef<VoiceState>("idle");
  const set = useCallback((s: VoiceState) => {
    ref.current = s;
    setState(s);
  }, []);

  const start = useCallback(async () => {
    try {
      await api.voiceStart();
      set("recording");
    } catch (e) {
      toast.error(String(e));
    }
  }, [set]);

  const stop = useCallback(async () => {
    set("transcribing");
    try {
      const r = await api.voiceStop();
      const when = r.date ? ` · ${r.date}` : "";
      const where = r.inbox ? "Está na caixa de entrada." : "Adicionada à lista.";
      if (r.fallback) {
        toast.warning(`Criada com o texto bruto: ${r.title}`, {
          description: `Não consegui interpretar com o Claude (${r.warning}). ${where}`,
          duration: 8000,
        });
      } else {
        toast.success(`${r.title}${when}`, { description: `“${r.transcript}” — ${where}` });
      }
      onCreated();
    } catch (e) {
      toast.error(String(e));
    } finally {
      set("idle");
    }
  }, [onCreated, set]);

  const cancel = useCallback(async () => {
    await api.voiceCancel().catch(() => {});
    set("idle");
  }, [set]);

  const toggle = useCallback(() => {
    if (ref.current === "idle") void start();
    else if (ref.current === "recording") void stop();
  }, [start, stop]);

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    const subs = [
      listen<string>("voice-status", (e) => set(e.payload as VoiceState)),
      listen("voice-toggle", () => toggleRef.current()),
    ];
    return () => {
      subs.forEach((p) => p.then((un) => un()));
    };
  }, [set]);

  return { state, toggle, cancel };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { format } from "date-fns";
import { ptBR as dfPtBR } from "date-fns/locale";
import { ptBR } from "react-day-picker/locale";
import { CalendarIcon, Loader2, Mic, Square } from "lucide-react";
import { api, fromIso, toIso } from "@/lib/api";
import { Calendar } from "@/components/ui/calendar";
import { useVoice } from "@/hooks/use-voice";
import { VoiceWaves } from "@/components/voice-waves";
import { cn } from "@/lib/utils";

/** Janelinha flutuante: Enter cria a tarefa, Esc fecha, microfone usa o fluxo de voz. */
export function QuickAdd() {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Data escolhida (ISO) e datas de hoje/amanhã vindas do Rust.
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const close = useCallback(() => {
    getCurrentWindow().hide().catch(() => {});
  }, []);

  const reset = useCallback(() => {
    setTitle("");
    setDate(null);
    setCalendarOpen(false);
    setError(null);
    setSaving(false);
    api.dates().then(([t, a]) => {
      setToday(t);
      setTomorrow(a);
    });
    // Aguarda a janela aparecer antes de focar.
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  // A voz cria a tarefa no Rust; aqui só fechamos a janela.
  const voice = useVoice(close);
  const voiceBusy = voice.state !== "idle";

  // A janela acompanha a altura do cartão (cresce quando o calendário abre).
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const fit = () => {
      const h = Math.ceil(el.getBoundingClientRect().height) + 16;
      getCurrentWindow().setSize(new LogicalSize(560, h)).catch(() => {});
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const sub = listen("quickadd-open", reset);
    reset();
    return () => {
      sub.then((un) => un());
    };
  }, [reset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (calendarOpen) setCalendarOpen(false);
      else if (voice.state === "recording") void voice.cancel();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, voice, calendarOpen]);

  const submit = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.quickAdd(t, date);
      setTitle("");
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const recording = voice.state === "recording";

  return (
    <div className="flex h-screen w-screen items-start justify-center p-2">
      <div ref={card} className="flex w-full flex-col justify-center rounded-2xl border bg-card px-4 py-2 text-card-foreground shadow-lg">
        <div className="flex items-center gap-2">
          {recording ? (
            <div className="flex h-9 flex-1 items-center gap-2 text-sm text-muted-foreground">
              <VoiceWaves level={voice.level} />
              <span>Gravando… clique no quadrado para criar</span>
            </div>
          ) : (
            <input
              ref={input}
              autoFocus
              value={title}
              disabled={saving || voiceBusy}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={voiceBusy ? "Processando voz…" : "Nova tarefa… (Enter para salvar)"}
              className="h-9 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          )}
          <button
            type="button"
            onClick={voice.toggle}
            disabled={saving || (voiceBusy && !recording)}
            aria-label={recording ? "Parar e criar" : "Criar tarefa por voz"}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-muted disabled:opacity-50",
              recording && "border-destructive bg-destructive/10 text-destructive",
            )}
          >
            {saving || (voiceBusy && !recording) ? (
              <Loader2 className="size-4 animate-spin" />
            ) : recording ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <Mic className="size-4" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-1.5 pb-1 pt-0.5">
          {[
            ["Hoje", today],
            ["Amanhã", tomorrow],
          ].map(([label, iso]) => (
            <button
              key={label}
              type="button"
              disabled={!iso}
              onClick={() => setDate(date === iso ? null : iso)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted",
                date === iso && "border-primary bg-primary/10 text-primary",
              )}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCalendarOpen((o) => !o)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted",
              date && date !== today && date !== tomorrow && "border-primary bg-primary/10 text-primary",
            )}
          >
            <CalendarIcon className="size-3.5" />
            {date && date !== today && date !== tomorrow && fromIso(date)
              ? format(fromIso(date)!, "d 'de' MMM", { locale: dfPtBR })
              : "Escolher data"}
          </button>
        </div>
        {calendarOpen && (
          <div className="flex justify-center border-t pt-2">
            <Calendar
              mode="single"
              locale={ptBR}
              selected={date ? fromIso(date) : undefined}
              defaultMonth={date ? fromIso(date) : undefined}
              onSelect={(d) => {
                setDate(d ? toIso(d) : null);
                setCalendarOpen(false);
                input.current?.focus();
              }}
            />
          </div>
        )}
        {error && <p className="truncate pb-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

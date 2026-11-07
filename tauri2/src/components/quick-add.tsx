import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { format } from "date-fns";
import { ptBR as dfPtBR } from "date-fns/locale";
import { ptBR } from "react-day-picker/locale";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarIcon, Check, Loader2, Mic, Square } from "lucide-react";
import { api, fromIso, toIso, type VoiceResult } from "@/lib/api";
import { Calendar } from "@/components/ui/calendar";
import { useVoice } from "@/hooks/use-voice";
import { VoiceWaves } from "@/components/voice-waves";
import { TimeField } from "@/components/time-field";
import { cn } from "@/lib/utils";

type Done = { title: string; date: string | null; inbox: boolean; warning: string | null };

/** Folga (px) que a janela ganha ao abrir o calendário; é transparente, então não aparece. */
const CALENDAR_ROOM = 360;

/** Janelinha flutuante: Enter cria a tarefa, Esc fecha, microfone usa o fluxo de voz. */
export function QuickAdd() {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Data escolhida (ISO) e datas de hoje/amanhã vindas do Rust.
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const close = useCallback(() => {
    getCurrentWindow().hide().catch(() => {});
  }, []);

  // Feedback de sucesso (mostrado ~1,2 s antes de esconder a janela).
  const [done, setDone] = useState<Done | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const showDone = useCallback(
    (d: Done) => {
      clearHideTimer();
      setDone(d);
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        close();
      }, 1200);
    },
    [clearHideTimer, close],
  );

  useEffect(() => clearHideTimer, [clearHideTimer]);

  const reset = useCallback(() => {
    clearHideTimer();
    setDone(null);
    setTitle("");
    setDate(null);
    setTime(null);
    setCalendarOpen(false);
    calendarRef.current = false;
    animating.current = false;
    fit.current();
    setError(null);
    setSaving(false);
    api.dates().then(([t, a]) => {
      setToday(t);
      setTomorrow(a);
    });
    // Aguarda a janela aparecer antes de focar.
    requestAnimationFrame(() => input.current?.focus());
  }, [clearHideTimer]);

  // A voz cria a tarefa no Rust; aqui mostramos o resultado e só depois fechamos.
  const onVoiceCreated = useCallback(
    (r: VoiceResult) =>
      showDone({
        title: r.title,
        date: r.date,
        inbox: r.inbox,
        warning: r.fallback || r.warning ? `Não consegui interpretar com o Claude${r.warning ? ` (${r.warning})` : ""}; usei o texto bruto.` : null,
      }),
    [showDone],
  );
  const onVoiceError = useCallback((msg: string) => setError(msg), []);
  const voice = useVoice(onVoiceCreated, { quiet: true, onError: onVoiceError });
  const voiceBusy = voice.state !== "idle";
  const working = voice.state === "transcribing" || voice.state === "interpreting";

  // A janela acompanha a altura do cartão. Com o calendário não dá para seguir o cartão quadro a
  // quadro (o redimensionamento nativo pula): ao abrir, a janela (transparente) cresce de uma vez
  // com folga e o cartão anima por dentro; ao terminar a animação, ajusta ao tamanho exato.
  const animating = useRef(false);
  const fit = useRef<() => void>(() => {});
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    fit.current = () => {
      if (animating.current) return;
      const h = Math.ceil(el.getBoundingClientRect().height) + 16;
      getCurrentWindow().setSize(new LogicalSize(560, h)).catch(() => {});
    };
    const ro = new ResizeObserver(() => fit.current());
    ro.observe(el);
    fit.current();
    return () => ro.disconnect();
  }, []);

  const calendarRef = useRef(false);
  const toggleCalendar = useCallback(() => {
    const open = calendarRef.current;
    calendarRef.current = !open;
    animating.current = true;
    if (!open) {
      const h = Math.ceil(card.current?.getBoundingClientRect().height ?? 90) + CALENDAR_ROOM + 16;
      getCurrentWindow().setSize(new LogicalSize(560, h)).catch(() => {});
    }
    setCalendarOpen(!open);
  }, []);

  const settle = useCallback(() => {
    animating.current = false;
    fit.current();
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
      if (done) {
        clearHideTimer();
        close();
      } else if (calendarOpen) toggleCalendar();
      else if (voice.state === "recording") void voice.cancel();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, voice, calendarOpen, done, clearHideTimer, toggleCalendar]);

  const submit = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.quickAdd(t, date, time);
      // Tarefa digitada vai direto para as tarefas (o Rust aprova sempre).
      setTitle("");
      showDone({ title: t, date, inbox: false, warning: null });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const recording = voice.state === "recording";
  const fade = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.15 } };

  if (done) {
    const d = done.date ? fromIso(done.date) : null;
    const detail = [
      d ? format(d, "EEEE, d 'de' MMMM", { locale: dfPtBR }) : null,
      done.inbox ? "na caixa de entrada" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="flex h-screen w-screen items-start justify-center p-2">
        <div ref={card} className="flex w-full flex-col justify-center rounded-2xl border bg-card px-4 py-2 text-card-foreground shadow-lg">
          <motion.div {...fade} role="status" className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary bg-primary/10 text-primary">
              <Check className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base leading-tight">
                <span className="text-muted-foreground">Tarefa criada · </span>
                {done.title}
              </p>
              <p className="h-4 truncate text-xs leading-4 text-muted-foreground">{detail}</p>
            </div>
          </motion.div>
          <p className="h-[26px] truncate pt-1 text-xs leading-5 text-muted-foreground">{done.warning}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-start justify-center p-2">
      <div ref={card} className="flex w-full flex-col justify-center rounded-2xl border bg-card px-4 py-2 text-card-foreground shadow-lg">
        <div className="flex items-center gap-2">
          {working ? (
            <motion.div {...fade} role="status" className="flex h-9 flex-1 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>{voice.state === "transcribing" ? "Transcrevendo…" : "Interpretando…"}</span>
            </motion.div>
          ) : recording ? (
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
              placeholder="Nova tarefa… (Enter para salvar)"
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
              disabled={!iso || working}
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
            onClick={toggleCalendar}
            disabled={working}
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
          <TimeField value={time} onChange={setTime} className="h-7 w-28 text-xs" />

        </div>
        <AnimatePresence initial={false} onExitComplete={settle}>
          {calendarOpen && (
            <motion.div
              key="calendario"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              onAnimationComplete={(def) => {
                if (typeof def === "object" && "height" in def && def.height === "auto") settle();
              }}
              className="overflow-hidden"
            >
              <div className="flex justify-center border-t pt-2">
                <Calendar
                  mode="single"
                  locale={ptBR}
                  selected={date ? fromIso(date) : undefined}
                  defaultMonth={date ? fromIso(date) : undefined}
                  onSelect={(d) => {
                    setDate(d ? toIso(d) : null);
                    toggleCalendar();
                    input.current?.focus();
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {error && <p className="truncate pb-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

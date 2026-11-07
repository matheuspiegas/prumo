import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

const DURATION = 6000;
/** Quanto tempo um desfazer silencioso (sem toast) responde ao Ctrl/⌘+Z. */
const SILENT_WINDOW = 30000;

type Entry = { id: string | number; run: () => Promise<unknown> | void };

/**
 * Toast com ação "Desfazer" (~6 s). O último desfazer também responde a
 * Ctrl/⌘+Z, exceto quando o foco está num campo de texto. Com `silent`, não mostra toast:
 * só o Ctrl/⌘+Z (por ~30 s) desfaz.
 */
export function useUndo(onDone?: () => void) {
  const last = useRef<Entry | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const exec = useCallback(async (entry: Entry) => {
    if (last.current === entry) last.current = null;
    if (entry.id !== "") toast.dismiss(entry.id);
    try {
      await entry.run();
    } catch (e) {
      toast.error(String(e));
    }
    onDoneRef.current?.();
  }, []);

  const push = useCallback(
    (message: string, run: () => Promise<unknown> | void, opts?: { silent?: boolean }) => {
      const entry: Entry = { id: "", run };
      const forget = () => {
        if (last.current === entry) last.current = null;
      };
      if (opts?.silent) {
        last.current = entry;
        setTimeout(forget, SILENT_WINDOW);
        return;
      }
      entry.id = toast(message, {
        duration: DURATION,
        action: { label: "Desfazer", onClick: () => void exec(entry) },
        onDismiss: forget,
        onAutoClose: forget,
      });
      last.current = entry;
    },
    [exec],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (!last.current) return;
      e.preventDefault();
      void exec(last.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exec]);

  return { push };
}

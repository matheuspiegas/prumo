import { useEffect, useState } from "react";

/** Janela grande (tela cheia ou quase): o diálogo de tarefa usa o layout expandido. */
const QUERY = "(min-width: 1280px) and (min-height: 760px)";

export function useExpandedLayout(): boolean {
  const [expanded, setExpanded] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setExpanded(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return expanded;
}

import { normalize } from "@/lib/search";

/** Destaca no texto os trechos que casam com a busca (sem diferenciar acento/caixa). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const norm = normalize(text);
  // Se o comprimento mudou, os índices não valem para o original: sem destaque.
  if (norm.length !== text.length) return <>{text}</>;
  const mark = new Array<boolean>(text.length).fill(false);
  for (const t of terms) {
    for (let i = norm.indexOf(t); i >= 0; i = norm.indexOf(t, i + t.length)) {
      mark.fill(true, i, i + t.length);
    }
  }
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && mark[j] === mark[i]) j++;
    const s = text.slice(i, j);
    parts.push(
      mark[i] ? (
        <mark key={i} className="rounded-sm bg-primary/20 text-inherit">
          {s}
        </mark>
      ) : (
        s
      ),
    );
    i = j;
  }
  return <>{parts}</>;
}

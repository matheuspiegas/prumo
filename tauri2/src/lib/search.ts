const MAP: Record<string, string> = {};
for (const [base, chars] of Object.entries({ a: "áàâãä", e: "éèêë", i: "íìîï", o: "óòôõö", u: "úùûü", c: "ç", n: "ñ" }))
  for (const c of chars) MAP[c] = base;

/** Minúsculas e sem acentos, espelhando `normalize` do core (mantém o comprimento). */
export function normalize(s: string): string {
  let out = "";
  for (const ch of s) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? (MAP[l] ?? l) : ch;
  }
  return out;
}

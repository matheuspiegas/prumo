/**
 * Imagens coladas nas notas.
 *
 * No texto da nota a imagem é o token `[Image #N]` (mesmo padrão do Claude Code). O arquivo anexado se
 * chama `image-N.ext`, e é esse nome que liga o token ao anexo: o banco não guarda nada a mais.
 * O formato antigo, `![nome](anexo:nome)`, continua sendo lido (ver `matchImageToken`).
 */

/** Número N de um arquivo `image-N.ext`; `null` se o nome não segue o padrão. */
export function imageNumber(filename: string): number | null {
  const m = /^image-(\d+)\.[a-z0-9]+$/i.exec(filename);
  return m ? Number(m[1]) : null;
}

/** Próximo número livre, dados os nomes dos anexos que a tarefa já tem. */
export function nextImageNumber(filenames: string[]): number {
  return filenames.reduce((max, f) => Math.max(max, imageNumber(f) ?? 0), 0) + 1;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Nome do arquivo de uma imagem colada: `image-N.ext`. */
export function imageFileName(n: number, mime: string): string {
  return `image-${n}.${EXT[mime] ?? "png"}`;
}

/** Texto do token no markdown da nota. */
export const imageToken = (n: number) => `[Image #${n}]`;

export type ImageTokenMatch = {
  /** Trecho consumido do texto. */
  raw: string;
  /** Número do token `[Image #N]`; `null` no formato antigo. */
  n: number | null;
  /** Nome do arquivo no formato antigo `![nome](anexo:nome)`; `null` no formato novo. */
  name: string | null;
};

/** Reconhece um token de imagem no INÍCIO de `src`. */
export function matchImageToken(src: string): ImageTokenMatch | null {
  const t = /^\[Image #(\d+)\]/.exec(src);
  if (t) return { raw: t[0], n: Number(t[1]), name: null };
  const legacy = /^!\[[^\]\n]*\]\(anexo:([^)\n]+)\)/.exec(src);
  if (legacy) return { raw: legacy[0], n: null, name: legacy[1] };
  return null;
}

/** Posição do próximo token de imagem em `src` (ou -1). */
export function findImageToken(src: string): number {
  const a = src.indexOf("[Image #");
  const b = src.indexOf("![");
  const hits = [a, b].filter((i) => i >= 0);
  return hits.length ? Math.min(...hits) : -1;
}

/**
 * Tira do markdown todos os tokens de uma imagem (`[Image #N]`, ou o formato antigo pelo nome) e
 * arruma as linhas em branco que sobram. Usado ao remover um anexo com o editor em modo markdown.
 */
export function stripImageToken(md: string, ref: { n: number | null; name: string | null }): string {
  let out = md;
  if (ref.n != null) out = out.split(`[Image #${ref.n}]`).join("");
  if (ref.name) out = out.split(`![${ref.name}](anexo:${ref.name})`).join("");
  return out
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

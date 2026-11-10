/**
 * Arrastar arquivos para o quadro. O Tauri intercepta o arrastar de arquivos da janela (o webview só
 * recebe os caminhos), então o quadro lê os bytes por um comando próprio e insere o conteúdo por código.
 * Aqui ficam as partes puras.
 */

export type DropKind = "image" | "library";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/** Extensão em minúsculas (sem o ponto); vazia se o nome não tem extensão. */
function extension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** O que dá para fazer com o arquivo solto: inserir como imagem, importar como biblioteca ou nada. */
export function dropKind(path: string): DropKind | null {
  const ext = extension(path);
  if (ext in IMAGE_MIME) return "image";
  if (ext === "excalidrawlib") return "library";
  return null;
}

export function imageMime(path: string): string {
  return IMAGE_MIME[extension(path)] ?? "application/octet-stream";
}

/** Lado maior de uma imagem recém-inserida no quadro (em unidades do quadro). */
export const INSERT_MAX_SIDE = 480;
/** Acima disso, imagens raster são reduzidas antes de entrar na cena (o JSON do quadro leva a imagem dentro). */
export const MAX_IMAGE_SIDE = 1600;

/** Reduz proporcionalmente para o lado maior caber em `max` (nunca amplia). */
export function fitSize(width: number, height: number, max = INSERT_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Id estável do arquivo na cena do Excalidraw: SHA-1 do conteúdo, em hexadecimal (o mesmo critério dele). */
export async function fileIdFromBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("não foi possível ler a imagem"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("o arquivo não é uma imagem válida"));
    img.src = src;
  });
}

export type PreparedImage = { dataURL: string; mimeType: string; width: number; height: number };

/**
 * Transforma os bytes de uma imagem em data URL e mede o tamanho. Imagens raster com o lado maior
 * acima de `MAX_IMAGE_SIDE` são reduzidas (GIF e SVG ficam como estão, para não perder animação nem vetor).
 */
export async function prepareImage(bytes: ArrayBuffer, mime: string): Promise<PreparedImage> {
  const dataURL = await blobToDataURL(new Blob([bytes], { type: mime }));
  const img = await loadImage(dataURL);
  const width = img.naturalWidth || 300;
  const height = img.naturalHeight || 200;
  const resizable = mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" || mime === "image/bmp";
  if (!resizable || Math.max(width, height) <= MAX_IMAGE_SIDE) return { dataURL, mimeType: mime, width, height };

  const scale = MAX_IMAGE_SIDE / Math.max(width, height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataURL, mimeType: mime, width, height };
  ctx.drawImage(img, 0, 0, w, h);
  const out = mime === "image/jpeg" ? "image/jpeg" : "image/png";
  return { dataURL: canvas.toDataURL(out, 0.92), mimeType: out, width: w, height: h };
}

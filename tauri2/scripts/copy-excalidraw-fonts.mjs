// Copia as fontes do Excalidraw para public/excalidraw-assets/fonts/, para o quadro funcionar offline
// (o board-canvas define window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/"; o pacote pede "fonts/<Familia>/<arquivo>").
// Exclui as Xiaolai* (fallback CJK, ~12 MB): caracteres fora do conjunto caem na fonte do sistema.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const dest = path.join(root, "public", "excalidraw-assets", "fonts");

if (!existsSync(src)) {
  console.error(`[excalidraw-fonts] pasta de fontes não encontrada: ${src} (rode npm install)`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

let count = 0;
let bytes = 0;
for (const entry of readdirSync(src, { withFileTypes: true })) {
  if (entry.name.startsWith("Xiaolai")) continue;
  const from = path.join(src, entry.name);
  const to = path.join(dest, entry.name);
  cpSync(from, to, { recursive: true });
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) return readdirSync(p).forEach((n) => walk(path.join(p, n)));
    count += 1;
    bytes += st.size;
  };
  walk(to);
}
console.log(`[excalidraw-fonts] ${count} arquivos (${(bytes / 1024).toFixed(0)} KB) em public/excalidraw-assets/fonts`);

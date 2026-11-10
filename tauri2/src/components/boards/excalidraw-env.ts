// Precisa ser importado ANTES de "@excalidraw/excalidraw": aponta as fontes para a pasta local
// (public/excalidraw-assets/fonts, copiada por scripts/copy-excalidraw-fonts.mjs), sem depender de CDN.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

if (typeof window !== "undefined") window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

export {};

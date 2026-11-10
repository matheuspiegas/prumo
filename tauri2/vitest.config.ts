import { defineConfig } from "vitest/config";
import path from "node:path";

// Testes das funções puras e do markdown do editor de notas (jsdom, sem o app rodando).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // O Excalidraw importa um JSON (open-color) que o Node não carrega externalizado: o vitest precisa embuti-lo.
    server: { deps: { inline: [/@excalidraw/, /open-color/] } },
  },
});

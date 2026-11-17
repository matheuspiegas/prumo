// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@/lib/api";

const h = vi.hoisted(() => ({
  api: {
    getSettings: vi.fn(),
    models: vi.fn(),
    mcpCommand: vi.fn(),
    detectAgent: vi.fn(),
    codexModels: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: h.api }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark", setTheme: vi.fn() }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsView } from "./settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings: Settings = {
  sttModelDir: null,
  agent: "claude",
  claudeModel: "haiku",
  claudeEffort: "low",
  claudePath: null,
  codexModel: "",
  codexEffort: "low",
  codexPath: null,
  autoApprove: false,
  shortcut: "CommandOrControl+Shift+Space",
  quickAddShortcut: "Ctrl+Alt+Space",
  reminders: true,
  launchAtLogin: false,
  startMinimized: true,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
  h.api.getSettings.mockResolvedValue(settings);
  h.api.models.mockResolvedValue({ models: [], searched: [] });
  h.api.mcpCommand.mockResolvedValue({ claude: "claude mcp add prumo", codex: "codex mcp add prumo" });
  h.api.detectAgent.mockResolvedValue({ path: "/bin/claude", version: "2.0", error: null });
  h.api.codexModels.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <TooltipProvider>
        <SettingsView />
      </TooltipProvider>,
    );
  });
}

const tab = (name: string) => host!.querySelector<HTMLButtonElement>(`[role="tab"]#tab-${name}`)!;
const panelText = () => host!.querySelector('[role="tabpanel"]')?.textContent ?? "";
const click = async (el: HTMLElement) => act(async () => el.click());

describe("SettingsView em abas", () => {
  it("abre em Geral e mostra só as configurações da aba escolhida", async () => {
    await render();
    expect([...host!.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      "Geral",
      "Voz",
      "Interpretação",
      "Agentes",
      "Aparência",
      "Diagnóstico",
    ]);
    expect(tab("geral").getAttribute("aria-selected")).toBe("true");
    expect(panelText()).toContain("Lembretes com notificação");
    expect(panelText()).toContain("Abrir com o sistema");
    expect(panelText()).not.toContain("Modelo de transcrição");

    await click(tab("voz"));
    // AnimatePresence troca o painel depois da saída do anterior.
    await act(async () => new Promise((r) => setTimeout(r, 250)));
    expect(tab("voz").getAttribute("aria-selected")).toBe("true");
    expect(panelText()).toContain("Modelo de transcrição");
    expect(panelText()).not.toContain("Lembretes com notificação");
    expect(localStorage.getItem("prumo.settings.tab")).toBe("voz");
  });

  it("marca a aba com alteração não salva e lembra a última aba", async () => {
    localStorage.setItem("prumo.settings.tab", "geral");
    await render();
    expect(tab("geral").querySelector('[title="Alterações não salvas"]')).toBeNull();
    await click(host!.querySelector<HTMLButtonElement>("#launch")!);
    expect(tab("geral").querySelector('[title="Alterações não salvas"]')).not.toBeNull();
    expect(tab("voz").querySelector('[title="Alterações não salvas"]')).toBeNull();
  });

  it("navega pelas abas com as setas", async () => {
    await render();
    tab("geral").focus();
    await act(async () => {
      tab("geral").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(tab("voz").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("voz"));
    await act(async () => {
      tab("voz").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(tab("diagnostico").getAttribute("aria-selected")).toBe("true");
  });
});

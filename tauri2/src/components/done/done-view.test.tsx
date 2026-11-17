// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletedItem, Task } from "@/lib/api";

const h = vi.hoisted(() => ({
  api: { listCompleted: vi.fn(), countCompleted: vi.fn(), setDone: vi.fn() },
  /** Largura que o ResizeObserver falso informa. */
  width: 600,
}));

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: h.api }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { DoneView } from "./done-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-11-17";
const task = (id: number, title: string, due: string | null = null): Task => ({
  id,
  title,
  notes: "",
  due,
  done: true,
  source: "manual",
  status: "active",
  priority: 0,
  dueTime: null,
  recurrence: null,
  parentId: null,
  deletedAt: null,
  subtasksDone: 0,
  subtasksTotal: 0,
  tags: [],
});
const items: CompletedItem[] = [
  { task: task(1, "Ir ao dentista", "2026-11-17"), completedAt: "2026-11-17 16:40" },
  { task: task(2, "Pagar a luz", "2026-11-14"), completedAt: "2026-11-16 09:05" },
  { task: task(3, "Ler o contrato"), completedAt: "2026-11-12 18:00" },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() {
      this.cb([{ contentRect: { width: h.width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  h.width = 600;
  localStorage.clear();
  Object.values(h.api).forEach((f) => f.mockReset());
  h.api.listCompleted.mockResolvedValue(items);
  h.api.countCompleted.mockResolvedValue(1);
  h.api.setDone.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(props: Partial<React.ComponentProps<typeof DoneView>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <TooltipProvider>
        <DoneView
          today={TODAY}
          tomorrow="2026-11-18"
          refreshKey={0}
          onOpenTask={vi.fn()}
          onChanged={vi.fn()}
          pushUndo={vi.fn()}
          {...props}
        />
      </TooltipProvider>,
    );
  });
  return host;
}

const text = () => host?.textContent ?? "";
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error("elemento não encontrado");
  await act(async () => (el as HTMLElement).click());
};
const button = (label: string) =>
  [...(host?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label")?.startsWith(label));

describe("DoneView", () => {
  it("carrega os últimos 30 dias, resume e compara com o período anterior", async () => {
    await render();
    expect(h.api.listCompleted).toHaveBeenCalledWith("2026-10-19", TODAY);
    expect(h.api.countCompleted).toHaveBeenCalledWith("2026-09-19", "2026-10-18");
    expect(text()).toContain("3 concluídas");
    expect(text()).toContain("2 a mais que nos 30 dias anteriores");
    // Pontualidade: dentista no dia (no prazo), luz 2 dias depois; o contrato não tinha data.
    expect(text()).toContain("1 de 2 com data no prazo");
    expect(text()).toContain("No prazo");
    expect(text()).toContain("2 dias depois");
  });

  it("agrupa por dia em lista quando a janela é estreita", async () => {
    await render();
    const sections = host!.querySelectorAll("section[aria-label]");
    const titles = [...sections].map((s) => s.querySelector("h2")?.textContent).filter((t) => t !== "Concluídas por dia");
    expect(titles).toEqual(["17 nov", "16 nov", "12 nov"]);
    expect(text()).toContain("Hoje");
    expect(text()).toContain("Ontem");
    // Hora da conclusão, sem risco no título.
    expect(text()).toContain("16:40");
    expect(host!.querySelector(".line-through")).toBeNull();
  });

  it("vira colunas em janela larga e reagrupa por semana", async () => {
    h.width = 1200;
    await render();
    expect(host!.querySelectorAll("section.w-\\[280px\\]").length).toBe(3);
    await click(button("Semana"));
    // 12 nov (quinta) fica na semana anterior a 16–17 nov.
    const cols = [...host!.querySelectorAll("section.w-\\[280px\\]")].map((s) => s.querySelector("h2")?.textContent);
    expect(cols).toEqual(["16 – 22 nov", "9 – 15 nov"]);
    expect(JSON.parse(localStorage.getItem("prumo.done.view") ?? "{}")).toMatchObject({ group: "week" });
  });

  it("troca o período e filtra pelo dia clicado no gráfico", async () => {
    await render();
    await click(button("7 dias"));
    expect(h.api.listCompleted).toHaveBeenLastCalledWith("2026-11-11", TODAY);
    const bar = host!.querySelector('button[aria-label^="segunda, 16 nov"]');
    await click(bar);
    expect(text()).toContain("Pagar a luz");
    expect(text()).not.toContain("Ir ao dentista");
    await click(bar); // de novo: desfaz o filtro
    expect(text()).toContain("Ir ao dentista");
  });

  it("reabre a tarefa e oferece desfazer", async () => {
    const pushUndo = vi.fn();
    const onChanged = vi.fn();
    await render({ pushUndo, onChanged });
    await click(host!.querySelector('[aria-label="Reabrir “Pagar a luz”"]'));
    expect(h.api.setDone).toHaveBeenCalledWith(2, false);
    expect(pushUndo).toHaveBeenCalledWith("Tarefa reaberta", expect.any(Function));
    expect(onChanged).toHaveBeenCalled();
  });

  it("mostra o estado vazio", async () => {
    h.api.listCompleted.mockResolvedValue([]);
    h.api.countCompleted.mockResolvedValue(0);
    await render();
    expect(text()).toContain("Nada concluído neste período.");
  });
});

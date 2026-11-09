// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SidebarProvider, useSidebar } from "./sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function State() {
  const { open } = useSidebar();
  return <span data-testid="estado">{open ? "aberta" : "fechada"}</span>;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((d) => d.remove());
  root = host = null;
});

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <SidebarProvider defaultOpen>
        <State />
      </SidebarProvider>,
    );
  });
  return () => host!.querySelector('[data-testid="estado"]')!.textContent;
}

const ctrlB = (target: EventTarget = window, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true, ...init }));

describe("atalho Ctrl+B da sidebar", () => {
  it("alterna a sidebar quando nada mais trata a tecla", async () => {
    const estado = await mount();
    expect(estado()).toBe("aberta");
    await act(async () => void ctrlB());
    expect(estado()).toBe("fechada");
    await act(async () => void ctrlB());
    expect(estado()).toBe("aberta");
  });

  it("não alterna se outro componente já tratou a tecla (negrito no editor de notas)", async () => {
    const estado = await mount();
    const campo = document.createElement("div");
    document.body.appendChild(campo);
    campo.addEventListener("keydown", (e) => e.preventDefault()); // o editor trata Mod-B e chama preventDefault
    await act(async () => void ctrlB(campo));
    expect(estado()).toBe("aberta");
    campo.remove();
  });

  it("não alterna com um diálogo aberto por cima", async () => {
    const estado = await mount();
    const dialogo = document.createElement("div");
    dialogo.setAttribute("role", "dialog");
    document.body.appendChild(dialogo);
    await act(async () => void ctrlB());
    expect(estado()).toBe("aberta");
  });
});

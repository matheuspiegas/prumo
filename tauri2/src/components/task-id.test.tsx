// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskId } from "@/components/task-id";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("TaskId", () => {
  it("mostra #id como texto simples (não clicável) por padrão", () => {
    act(() => root.render(<TaskId id={42} />));
    expect(host.textContent).toBe("#42");
    expect(host.querySelector("button")).toBeNull();
  });

  it("copiável: o clique copia '#id' para a área de transferência", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    act(() => root.render(<TaskId id={7} copyable />));
    await act(async () => host.querySelector("button")!.click());
    expect(writeText).toHaveBeenCalledWith("#7");
    expect(toast.success).toHaveBeenCalledWith("#7 copiado");
  });
});

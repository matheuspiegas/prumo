// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { dropKind, fileIdFromBytes, fitSize, imageMime, MAX_IMAGE_SIDE, prepareImage } from "./board-drop-utils";

describe("dropKind e imageMime", () => {
  it("reconhece imagens e bibliotecas, sem diferenciar maiúsculas, com caminho do Windows ou do Unix", () => {
    for (const p of ["a.png", "B.JPG", "c.jpeg", "d.Gif", "e.webp", "f.svg", "g.bmp", "C:\\Users\\x\\foto.PNG", "/tmp/a/b.webp"]) {
      expect(dropKind(p), p).toBe("image");
    }
    expect(dropKind("lib.excalidrawlib")).toBe("library");
    expect(dropKind("C:\\x\\Minha Lib.EXCALIDRAWLIB")).toBe("library");
  });

  it("recusa o resto", () => {
    for (const p of ["a.exe", "a.txt", "a.json", "a.excalidraw", "semextensao", ".png", "a.png.exe", "C:\\pasta.png\\arquivo"]) {
      expect(dropKind(p), p).toBeNull();
    }
  });

  it("dá o tipo MIME pela extensão", () => {
    expect(imageMime("x.PNG")).toBe("image/png");
    expect(imageMime("x.jpg")).toBe("image/jpeg");
    expect(imageMime("x.jpeg")).toBe("image/jpeg");
    expect(imageMime("x.svg")).toBe("image/svg+xml");
    expect(imageMime("x.txt")).toBe("application/octet-stream");
  });
});

describe("fitSize", () => {
  it("reduz proporcionalmente para o lado maior caber e nunca amplia", () => {
    expect(fitSize(1000, 500)).toEqual({ width: 480, height: 240 });
    expect(fitSize(500, 1000)).toEqual({ width: 240, height: 480 });
    expect(fitSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(fitSize(960, 960, 480)).toEqual({ width: 480, height: 480 });
  });

  it("nunca devolve lado zero", () => {
    expect(fitSize(10000, 1)).toEqual({ width: 480, height: 1 });
    expect(fitSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe("fileIdFromBytes", () => {
  it("é o SHA-1 do conteúdo em hexadecimal", async () => {
    const bytes = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await fileIdFromBytes(bytes)).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
});

describe("prepareImage", () => {
  const realImage = globalThis.Image;
  const realCreate = document.createElement.bind(document);
  afterEach(() => {
    globalThis.Image = realImage;
    vi.restoreAllMocks();
  });

  /** O jsdom não decodifica imagens: simula uma com o tamanho dado. */
  function fakeImage(width: number, height: number, fail = false) {
    globalThis.Image = class {
      naturalWidth = width;
      naturalHeight = height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()));
      }
    } as unknown as typeof Image;
  }

  const bytes = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;

  it("mantém a imagem pequena como está", async () => {
    fakeImage(800, 600);
    const r = await prepareImage(bytes, "image/png");
    expect(r).toMatchObject({ mimeType: "image/png", width: 800, height: 600 });
    expect(r.dataURL.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("reduz imagem raster grande para o limite e mantém a proporção", async () => {
    fakeImage(4000, 2000);
    const draw = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return realCreate(tag);
      return { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toDataURL: (t: string) => `data:${t};base64,REDUZIDA` } as unknown as HTMLCanvasElement;
    });
    const r = await prepareImage(bytes, "image/jpeg");
    expect(r).toMatchObject({ mimeType: "image/jpeg", width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE / 2 });
    expect(r.dataURL).toBe("data:image/jpeg;base64,REDUZIDA");
    expect(draw).toHaveBeenCalledOnce();
  });

  it("não mexe em SVG nem em GIF, mesmo grandes", async () => {
    fakeImage(5000, 5000);
    expect((await prepareImage(bytes, "image/svg+xml")).width).toBe(5000);
    expect((await prepareImage(bytes, "image/gif")).width).toBe(5000);
  });

  it("falha com mensagem clara se o arquivo não é uma imagem", async () => {
    fakeImage(0, 0, true);
    await expect(prepareImage(bytes, "image/png")).rejects.toThrow("não é uma imagem válida");
  });
});

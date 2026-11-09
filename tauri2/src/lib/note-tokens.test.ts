import { describe, expect, it } from "vitest";
import { findImageToken, imageFileName, imageNumber, imageToken, matchImageToken, nextImageNumber, stripImageToken } from "./note-tokens";

describe("note-tokens", () => {
  it("lê o número pelo nome do arquivo", () => {
    expect(imageNumber("image-1.png")).toBe(1);
    expect(imageNumber("IMAGE-12.JPG")).toBe(12);
    expect(imageNumber("imagem-20261109-1.png")).toBeNull();
    expect(imageNumber("image-1.png.exe")).toBeNull();
    expect(imageNumber("foto.png")).toBeNull();
  });

  it("escolhe o próximo número livre sem reaproveitar buracos", () => {
    expect(nextImageNumber([])).toBe(1);
    expect(nextImageNumber(["image-1.png", "image-3.png", "log.txt"])).toBe(4);
    expect(nextImageNumber(["imagem-20261109-9.png"])).toBe(1);
  });

  it("gera nome e token", () => {
    expect(imageFileName(2, "image/jpeg")).toBe("image-2.jpg");
    expect(imageFileName(5, "image/webp")).toBe("image-5.webp");
    expect(imageFileName(1, "image/qualquer")).toBe("image-1.png");
    expect(imageToken(3)).toBe("[Image #3]");
  });

  it("reconhece o token novo e o formato antigo só no início do texto", () => {
    expect(matchImageToken("[Image #7] resto")).toEqual({ raw: "[Image #7]", n: 7, name: null });
    expect(matchImageToken("![x.png](anexo:x.png) resto")).toEqual({ raw: "![x.png](anexo:x.png)", n: null, name: "x.png" });
    expect(matchImageToken("texto [Image #1]")).toBeNull();
    expect(matchImageToken("[Image #]")).toBeNull();
    expect(matchImageToken("![alt](https://site/x.png)")).toBeNull();
  });

  it("acha a posição do próximo token", () => {
    expect(findImageToken("abc [Image #1]")).toBe(4);
    expect(findImageToken("abc ![x](anexo:x)")).toBe(4);
    expect(findImageToken("sem nada")).toBe(-1);
  });
});

describe("stripImageToken", () => {
  it("remove o token e as linhas em branco que sobram", () => {
    const md = "Passos:\n\n[Image #1]\n\nDepois [Image #2] fim";
    expect(stripImageToken(md, { n: 1, name: null })).toBe("Passos:\n\nDepois [Image #2] fim");
    expect(stripImageToken(md, { n: 2, name: null })).toBe("Passos:\n\n[Image #1]\n\nDepois  fim");
  });

  it("remove o formato antigo pelo nome", () => {
    expect(stripImageToken("a\n\n![x.png](anexo:x.png)\n\nb", { n: null, name: "x.png" })).toBe("a\n\nb");
  });
});

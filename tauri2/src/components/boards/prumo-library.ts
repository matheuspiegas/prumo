import { convertToExcalidrawElements, FONT_FAMILY } from "@excalidraw/excalidraw";
import type { LibraryItem, LibraryItems } from "@excalidraw/excalidraw/types";

/**
 * Biblioteca embutida "Prumo": formas de fluxograma, programação/arquitetura, UML e geométricas extras.
 *
 * Decisões de estilo:
 * - Fundo transparente e cor de traço NÃO fixada (herda o padrão do Excalidraw), para funcionar nos temas claro e escuro.
 * - `roughness: 0` (traço limpo): as curvas das formas compostas (cilindro, nuvem, chave...) são polilinhas amostradas,
 *   e o modo "à mão" do Excalidraw faria essas linhas tremerem e a emenda das peças ficar visível.
 * - `strokeWidth: 2`; texto em Nunito 16. Tamanhos parecidos (~160x80).
 *
 * Cada item é um GRUPO (todos os elementos compartilham um `groupId`). Retângulo, losango e elipse usam rótulo vinculado
 * à forma; nas formas compostas o texto é um elemento solto centralizado sobre a forma.
 *
 * A conversão (`convertToExcalidrawElements`) mede texto em canvas 2D, então só roda sob demanda (e é memoizada) em
 * `getPrumoLibraryItems()`. Se falhar (por exemplo, sem canvas), devolve [] sem memoizar e tenta de novo na próxima.
 */

type Skeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number];
type Pt = [number, number];

const FONT_SIZE = 16;
const FONT = FONT_FAMILY.Nunito;
/** Data fixa (10/11/2026) para a lista ser determinística. */
const CREATED = 1794268800000;

/** Texto solto, centralizado em (cx, cy) ou, com `align: "left"`, com a borda esquerda em cx. */
type FreeText = { text: string; cx: number; cy: number; align?: "center" | "left"; fontSize?: number };

type ItemSpec = {
  slug: string;
  name: string;
  shapes: Skeleton[];
  texts?: FreeText[];
};

// ---------- construtores de formas ----------

const STYLE = { strokeWidth: 2, roughness: 0, backgroundColor: "transparent" } as const;

/** Rótulo vinculado (texto dentro da forma). */
function label(text: string, textAlign: "left" | "center" = "center") {
  return { text, fontSize: FONT_SIZE, fontFamily: FONT, textAlign } as const;
}

function rect(x: number, y: number, w: number, h: number, text?: string, extra: Record<string, unknown> = {}): Skeleton {
  return { type: "rectangle", x, y, width: w, height: h, ...STYLE, ...(text ? { label: label(text) } : {}), ...extra } as Skeleton;
}

function ellipse(x: number, y: number, w: number, h: number, text?: string): Skeleton {
  return { type: "ellipse", x, y, width: w, height: h, ...STYLE, ...(text ? { label: label(text) } : {}) } as Skeleton;
}

function diamond(x: number, y: number, w: number, h: number, text?: string): Skeleton {
  return { type: "diamond", x, y, width: w, height: h, ...STYLE, ...(text ? { label: label(text) } : {}) } as Skeleton;
}

/** Polilinha por pontos absolutos; `closed` repete o primeiro ponto no fim. */
function poly(pts: Pt[], closed = false): Skeleton {
  const [x0, y0] = pts[0];
  const points = pts.map(([x, y]) => [x - x0, y - y0] as Pt);
  if (closed) points.push([0, 0]);
  // A conversão não recalcula width/height das linhas (usa 100x0 por padrão): informamos o tamanho real dos pontos.
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return { type: "line", x: x0, y: y0, points, width, height, ...STYLE } as Skeleton;
}

function arrow(x: number, y: number, dx: number, dy: number): Skeleton {
  return {
    type: "arrow",
    x,
    y,
    points: [
      [0, 0],
      [dx, dy],
    ],
    endArrowhead: "arrow",
    startArrowhead: null,
    ...STYLE,
  } as Skeleton;
}

/** Pontos de um arco de elipse (ângulos em graus; y cresce para baixo). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** Hexágono achatado de largura w e altura h. */
function hexagon(w: number, h: number, inset = 24): Pt[] {
  return [
    [inset, 0],
    [w - inset, 0],
    [w, h / 2],
    [w - inset, h],
    [inset, h],
    [0, h / 2],
  ];
}

/** Boneco palito (cabeça, tronco, braços, pernas) com 80 de largura; o texto vai em y = 108. */
function stickFigure(): Skeleton[] {
  return [
    ellipse(28, 0, 24, 24),
    poly([
      [40, 24],
      [40, 64],
    ]),
    poly([
      [16, 38],
      [64, 38],
    ]),
    poly([
      [18, 94],
      [40, 64],
      [62, 94],
    ]),
  ];
}

/** Página com canto dobrado (arquivo e nota). */
function foldedPage(w: number, h: number, fold: number): Skeleton[] {
  return [
    poly(
      [
        [0, 0],
        [w - fold, 0],
        [w, fold],
        [w, h],
        [0, h],
      ],
      true,
    ),
    poly([
      [w - fold, 0],
      [w - fold, fold],
      [w, fold],
    ]),
  ];
}

/** Metade "{" de uma chave de altura 120 e largura 30 (espelhada com `mirrorAt` para o "}"). */
function brace(mirrorAt?: number): Skeleton {
  const pts: Pt[] = [
    ...arc(30, 20, 15, 20, 270, 180, 12),
    ...arc(0, 40, 15, 20, 0, 90, 12),
    ...arc(0, 80, 15, 20, 270, 360, 12),
    ...arc(30, 100, 15, 20, 180, 90, 12),
  ];
  return poly(mirrorAt === undefined ? pts : pts.map(([x, y]) => [mirrorAt - x, y] as Pt));
}

/** Contorno de nuvem: elipse com bordas "ondulantes" (8 gomos) amostrada em 160 pontos. */
function cloudOutline(rx: number, ry: number): Pt[] {
  const pts: Pt[] = [];
  const n = 160;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = 0.86 + 0.14 * Math.abs(Math.sin(4 * t));
    pts.push([rx + rx * k * Math.cos(t), ry + ry * k * Math.sin(t)]);
  }
  return pts;
}

/** Estrela de 5 pontas inscrita num círculo de raio r. */
function starOutline(r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push([r + rr * Math.cos(a), r + rr * Math.sin(a)]);
  }
  return pts;
}

// ---------- especificação dos itens (na ordem das categorias) ----------

function buildSpecs(): ItemSpec[] {
  return [
    // ===== Fluxograma =====
    {
      slug: "fluxo-terminador",
      name: "Fluxograma: Início / Fim",
      // Pílula 160x64: dois semicírculos de raio 32 ligados por retas.
      shapes: [poly([...arc(128, 32, 32, 32, -90, 90, 20), ...arc(32, 32, 32, 32, 90, 270, 20)], true)],
      texts: [{ text: "Início / Fim", cx: 80, cy: 32 }],
    },
    { slug: "fluxo-processo", name: "Fluxograma: Processo", shapes: [rect(0, 0, 160, 80, "Processo")] },
    { slug: "fluxo-decisao", name: "Fluxograma: Decisão", shapes: [diamond(0, 0, 160, 100, "Decisão")] },
    {
      slug: "fluxo-entrada-saida",
      name: "Fluxograma: Entrada / Saída",
      shapes: [
        poly(
          [
            [24, 0],
            [160, 0],
            [136, 80],
            [0, 80],
          ],
          true,
        ),
      ],
      texts: [{ text: "Entrada / Saída", cx: 80, cy: 40 }],
    },
    {
      slug: "fluxo-documento",
      name: "Fluxograma: Documento",
      // Base ondulada: um ciclo de seno entre x = 160 e x = 0.
      shapes: [
        poly(
          [
            [0, 0],
            [160, 0],
            ...Array.from({ length: 33 }, (_, i) => [160 - (160 * i) / 32, 68 + 8 * Math.sin((i / 32) * Math.PI * 2)] as Pt),
          ],
          true,
        ),
      ],
      texts: [{ text: "Documento", cx: 80, cy: 34 }],
    },
    {
      slug: "fluxo-subprocesso",
      name: "Fluxograma: Subprocesso",
      shapes: [
        rect(0, 0, 160, 80, "Subprocesso"),
        poly([
          [16, 0],
          [16, 80],
        ]),
        poly([
          [144, 0],
          [144, 80],
        ]),
      ],
    },
    { slug: "fluxo-conector", name: "Fluxograma: Conector", shapes: [ellipse(0, 0, 48, 48, "A")] },
    {
      slug: "fluxo-preparacao",
      name: "Fluxograma: Preparação",
      shapes: [poly(hexagon(160, 80), true)],
      texts: [{ text: "Preparação", cx: 80, cy: 40 }],
    },
    {
      slug: "fluxo-atraso",
      name: "Fluxograma: Atraso",
      // Forma em "D": reta à esquerda e semicírculo à direita (raio 40).
      shapes: [poly([[0, 0], [100, 0], ...arc(100, 40, 40, 40, -90, 90, 20), [0, 80]], true)],
      texts: [{ text: "Atraso", cx: 66, cy: 40 }],
    },

    // ===== Programação e arquitetura =====
    {
      slug: "arq-banco-de-dados",
      name: "Banco de dados",
      // Cilindro 140x112: elipse da tampa + lados + meia elipse da base.
      shapes: [
        ellipse(0, 0, 140, 28),
        poly([[0, 14], [0, 98], ...arc(70, 98, 70, 14, 180, 0, 28), [140, 14]]),
      ],
      texts: [{ text: "Banco de dados", cx: 70, cy: 62 }],
    },
    {
      slug: "arq-servidor",
      name: "Servidor",
      // Rack de 3 faixas 150x30, cada uma com um LED à esquerda.
      shapes: [
        rect(0, 0, 150, 30),
        rect(0, 30, 150, 30),
        rect(0, 60, 150, 30),
        ellipse(10, 11, 8, 8),
        ellipse(10, 41, 8, 8),
        ellipse(10, 71, 8, 8),
      ],
      texts: [{ text: "Servidor", cx: 85, cy: 45 }],
    },
    {
      slug: "arq-fila",
      name: "Fila / Mensageria",
      // Caixa com 3 mensagens e setas de entrada e saída.
      shapes: [
        rect(0, 0, 180, 80),
        rect(24, 12, 32, 24),
        rect(74, 12, 32, 24),
        rect(124, 12, 32, 24),
        arrow(-36, 40, 34, 0),
        arrow(182, 40, 34, 0),
      ],
      texts: [{ text: "Fila", cx: 90, cy: 58 }],
    },
    {
      slug: "arq-api",
      name: "API / Gateway",
      shapes: [rect(0, 0, 160, 80, "API / Gateway", { roundness: { type: 3 } }), arrow(-40, 40, 38, 0), arrow(162, 40, 38, 0)],
    },
    {
      slug: "arq-cache",
      name: "Cache",
      // Retângulo tracejado com um raio no canto.
      shapes: [
        rect(0, 0, 160, 80, "Cache", { strokeStyle: "dashed" }),
        poly(
          [
            [22, 10],
            [12, 26],
            [19, 26],
            [15, 40],
            [29, 22],
            [22, 22],
          ],
          true,
        ),
      ],
    },
    {
      slug: "arq-usuario",
      name: "Usuário",
      // Busto: cabeça e ombros (meia elipse).
      shapes: [ellipse(24, 0, 32, 32), poly([[0, 82], ...arc(40, 82, 40, 36, 180, 360, 24)], true)],
      texts: [{ text: "Usuário", cx: 40, cy: 102 }],
    },
    {
      slug: "arq-navegador",
      name: "Navegador / Tela",
      // Janela com barra de título (3 botões e barra de endereço).
      shapes: [
        rect(0, 0, 180, 120),
        poly([
          [0, 26],
          [180, 26],
        ]),
        ellipse(10, 9, 8, 8),
        ellipse(26, 9, 8, 8),
        ellipse(42, 9, 8, 8),
        rect(64, 6, 104, 14, undefined, { roundness: { type: 3 } }),
      ],
      texts: [{ text: "Navegador", cx: 90, cy: 74 }],
    },
    {
      slug: "arq-arquivo",
      name: "Arquivo",
      shapes: foldedPage(88, 112, 28),
      texts: [{ text: "Arquivo", cx: 44, cy: 70 }],
    },
    {
      slug: "arq-container",
      name: "Container",
      // Caixa externa com 3 contêineres pequenos dentro.
      shapes: [
        rect(0, 0, 180, 110, undefined, { roundness: { type: 3 } }),
        rect(20, 14, 36, 28),
        rect(72, 14, 36, 28),
        rect(124, 14, 36, 28),
      ],
      texts: [{ text: "Container", cx: 90, cy: 76 }],
    },
    {
      slug: "arq-nuvem",
      name: "Nuvem",
      shapes: [poly(cloudOutline(90, 56), true)],
      texts: [{ text: "Nuvem", cx: 90, cy: 56 }],
    },
    {
      slug: "arq-funcao",
      name: "Função",
      // Sem "λ" porque a Nunito não tem o glifo grego.
      shapes: [rect(0, 0, 160, 80, "fn()\nFunção", { roundness: { type: 3 } })],
    },
    {
      slug: "arq-microsservico",
      name: "Microsserviço",
      shapes: [poly(hexagon(140, 90, 28), true)],
      texts: [{ text: "Serviço", cx: 70, cy: 45 }],
    },
    {
      slug: "arq-celular",
      name: "Celular / App",
      shapes: [
        rect(0, 0, 70, 120, undefined, { roundness: { type: 3 } }),
        poly([
          [24, 10],
          [46, 10],
        ]),
        ellipse(29, 100, 12, 12),
      ],
      texts: [{ text: "App", cx: 35, cy: 56 }],
    },

    // ===== UML básico =====
    {
      slug: "uml-classe",
      name: "UML: Classe",
      // Três compartimentos empilhados (rótulos vinculados): nome, atributos, métodos.
      shapes: [
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: 170,
          height: 32,
          ...STYLE,
          label: label("Classe"),
        } as Skeleton,
        {
          type: "rectangle",
          x: 0,
          y: 32,
          width: 170,
          height: 44,
          ...STYLE,
          label: label("- atributo: Tipo", "left"),
        } as Skeleton,
        {
          type: "rectangle",
          x: 0,
          y: 76,
          width: 170,
          height: 44,
          ...STYLE,
          label: label("+ método(): Tipo", "left"),
        } as Skeleton,
      ],
    },
    { slug: "uml-ator", name: "UML: Ator", shapes: stickFigure(), texts: [{ text: "Ator", cx: 40, cy: 110 }] },
    { slug: "uml-nota", name: "UML: Nota", shapes: foldedPage(160, 90, 28), texts: [{ text: "Nota", cx: 80, cy: 50 }] },

    // ===== Geométricas extras =====
    {
      slug: "geo-triangulo",
      name: "Triângulo",
      shapes: [
        poly(
          [
            [80, 0],
            [160, 100],
            [0, 100],
          ],
          true,
        ),
      ],
    },
    { slug: "geo-estrela", name: "Estrela", shapes: [poly(starOutline(60), true)] },
    { slug: "geo-chave", name: "Chave { }", shapes: [brace(), brace(30 + 70 + 30)] },
    {
      slug: "geo-seta-grossa",
      name: "Seta grossa",
      shapes: [
        poly(
          [
            [0, 25],
            [100, 25],
            [100, 0],
            [160, 40],
            [100, 80],
            [100, 55],
            [0, 55],
          ],
          true,
        ),
      ],
    },
    {
      slug: "geo-seta-dupla",
      name: "Seta dupla",
      shapes: [
        poly(
          [
            [0, 40],
            [50, 0],
            [50, 25],
            [110, 25],
            [110, 0],
            [160, 40],
            [110, 80],
            [110, 55],
            [50, 55],
            [50, 80],
          ],
          true,
        ),
      ],
    },
  ];
}

// ---------- montagem dos itens ----------

function buildItem(spec: ItemSpec): LibraryItem {
  const texts: Skeleton[] = (spec.texts ?? []).map(
    (t) =>
      ({
        type: "text",
        text: t.text,
        x: 0,
        y: 0,
        fontSize: t.fontSize ?? FONT_SIZE,
        fontFamily: FONT,
        textAlign: t.align === "left" ? "left" : "center",
        strokeWidth: 2,
      }) as Skeleton,
  );

  // Ordem preservada pela conversão: formas (com seus textos vinculados) e depois os textos soltos.
  const elements = convertToExcalidrawElements([...spec.shapes, ...texts], { regenerateIds: true }).map((e) => ({ ...e }));

  // Textos soltos: centraliza sobre o ponto pedido, já com a largura/altura medidas.
  const free = elements.filter((e) => e.type === "text" && !("containerId" in e && e.containerId));
  free.forEach((el, i) => {
    const t = spec.texts?.[i];
    if (!t) return;
    el.x = t.align === "left" ? t.cx : t.cx - el.width / 2;
    el.y = t.cy - el.height / 2;
  });

  // Um único grupo por item e coordenadas começando perto de (0, 0).
  const groupId = `prumo-grupo-${spec.slug}`;
  // Em linhas e setas, x/y é o primeiro ponto; o canto real é o menor ponto.
  const corner = (e: (typeof elements)[number], axis: 0 | 1) =>
    (axis === 0 ? e.x : e.y) + ("points" in e ? Math.min(...e.points.map((p) => p[axis])) : 0);
  const minX = Math.min(...elements.map((e) => corner(e, 0)));
  const minY = Math.min(...elements.map((e) => corner(e, 1)));
  for (const el of elements) {
    el.groupIds = [groupId];
    el.x -= minX;
    el.y -= minY;
  }

  return { id: `prumo-${spec.slug}`, status: "published", created: CREATED, name: spec.name, elements };
}

let cache: LibraryItems | null = null;

/** Itens da biblioteca "Prumo", gerados uma vez (memoizado). Em caso de falha devolve [] e tenta de novo depois. */
export function getPrumoLibraryItems(): LibraryItems {
  if (cache) return cache;
  try {
    cache = buildSpecs().map(buildItem);
    return cache;
  } catch (err) {
    console.warn("Biblioteca Prumo: não foi possível gerar as formas.", err);
    return [];
  }
}

/** Compatível com o contrato: lista pronta quando a conversão funciona no momento do import (vazia caso contrário). */
export const PRUMO_LIBRARY_ITEMS: LibraryItems = getPrumoLibraryItems();

import { describe, expect, it } from "vitest";
import type { Task } from "./api";
import { buckets, groupItems, groupKey, periodOf, previousPeriod, punctuality, type CompletedItem } from "./done";

const task = (id: number, due: string | null = null): Task => ({
  id,
  title: `t${id}`,
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
const item = (id: number, completedAt: string, due: string | null = null): CompletedItem => ({ task: task(id, due), completedAt });

// 2026-11-17 é uma terça-feira.
const TODAY = "2026-11-17";

describe("períodos", () => {
  it("calcula os presets a partir de hoje", () => {
    expect(periodOf("7d", TODAY)).toEqual({ from: "2026-11-11", to: TODAY });
    expect(periodOf("30d", TODAY)).toEqual({ from: "2026-10-19", to: TODAY });
    expect(periodOf("month", TODAY)).toEqual({ from: "2026-11-01", to: TODAY });
    expect(periodOf("all", TODAY)).toEqual({ from: null, to: null });
    expect(periodOf("custom", TODAY, { from: "2026-01-01", to: "2026-01-31" })).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("compara com o período anterior de mesmo tamanho", () => {
    expect(previousPeriod("7d", periodOf("7d", TODAY))).toEqual({ from: "2026-11-04", to: "2026-11-10" });
    expect(previousPeriod("month", periodOf("month", TODAY))).toEqual({ from: "2026-10-01", to: "2026-10-17" });
    // 31 de março → fevereiro termina antes: corta no fim do mês.
    expect(previousPeriod("month", { from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("all", periodOf("all", TODAY))).toBeNull();
  });
});

describe("agrupamento", () => {
  it("usa a segunda-feira como início da semana", () => {
    expect(groupKey("2026-11-17", "week")).toBe("2026-11-16");
    expect(groupKey("2026-11-15", "week")).toBe("2026-11-09"); // domingo fica na semana anterior
    expect(groupKey("2026-11-17", "month")).toBe("2026-11-01");
  });

  it("agrupa do mais recente para o mais antigo com títulos relativos", () => {
    const items = [item(1, "2026-11-17 14:00"), item(2, "2026-11-16 09:00"), item(3, "2026-11-16 08:00"), item(4, "2026-11-03 10:00")];
    const days = groupItems(items, "day", TODAY);
    expect(days.map((g) => [g.key, g.items.length])).toEqual([
      ["2026-11-17", 1],
      ["2026-11-16", 2],
      ["2026-11-03", 1],
    ]);
    expect(days[0].kicker).toMatch(/^Hoje/);
    expect(days[1].kicker).toMatch(/^Ontem/);

    const weeks = groupItems(items, "week", TODAY);
    expect(weeks.map((g) => g.kicker)).toEqual(["Esta semana", "Semana"]);
    expect(weeks[0].title).toBe("16 – 22 nov");

    const months = groupItems([...items, item(5, "2026-10-30 10:00")], "month", TODAY);
    expect(months.map((g) => [g.title, g.kicker])).toEqual([
      ["Novembro", "Este mês"],
      ["Outubro", "Mês passado"],
    ]);
  });
});

describe("pontualidade", () => {
  it("compara a conclusão com a data prevista", () => {
    expect(punctuality(null, TODAY)).toBeNull();
    expect(punctuality(TODAY, TODAY)).toMatchObject({ kind: "ontime", label: "No prazo" });
    expect(punctuality("2026-11-18", TODAY)).toMatchObject({ kind: "early", label: "1 dia antes" });
    expect(punctuality("2026-11-14", TODAY)).toMatchObject({ kind: "late", days: 3, label: "3 dias depois" });
  });
});

describe("barras do gráfico", () => {
  it("cria uma barra por dia, inclusive os dias sem conclusões", () => {
    const items = [item(1, "2026-11-17 14:00"), item(2, "2026-11-17 09:00"), item(3, "2026-11-12 10:00")];
    const b = buckets(items, periodOf("7d", TODAY), TODAY);
    expect(b.by).toBe("day");
    expect(b.list.map((x) => x.count)).toEqual([0, 1, 0, 0, 0, 0, 2]);
  });

  it("agrupa por semana em períodos longos e começa na conclusão mais antiga em 'Tudo'", () => {
    const items = [item(1, "2026-11-17 14:00"), item(2, "2026-06-03 10:00")];
    const b = buckets(items, periodOf("all", TODAY), TODAY);
    expect(b.by).toBe("week");
    expect(b.list[0]).toMatchObject({ key: "2026-06-01", from: "2026-06-03", count: 1 });
    expect(b.list[b.list.length - 1]).toMatchObject({ key: "2026-11-16", to: TODAY, count: 1 });
    expect(b.list.reduce((s, x) => s + x.count, 0)).toBe(2);
  });
});

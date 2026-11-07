# Plano: visão Semana (planejador por dia)

Visão em colunas por dia, para ver a semana e reagendar arrastando. **Não é um kanban**: kanban separa por
estágio do trabalho (A fazer / Fazendo / Feito); aqui a coluna é *quando*. O kanban por estágio fica para uma
fase posterior e reaproveita a base criada aqui (cartão, arrastar entre colunas, `move_task`).

## Decisões

1. Colunas com rolagem horizontal (3 a 4 dias visíveis por vez), não agenda vertical.
2. Sem mudança de schema: mover um cartão só altera `due_date` (e a ordem em `position`).
3. Nome na interface: **Semana**.

## Escopo da v1

Colunas, da esquerda para a direita: **Atrasadas** · 7 dias a partir da data inicial (padrão: hoje) · **Sem data**.

- **Atrasadas:** só origem. Não aceita soltar (é uma coluna derivada).
- **Dias:** mostram pendentes (ordem manual) e, ao final, as concluídas do dia, esmaecidas.
- **Sem data:** tarefas ativas pendentes sem `due_date`. Soltar aqui remove a data.
- Navegação `‹ Hoje ›` desloca a janela de 7 dias; o rótulo mostra o intervalo ("9 – 15 nov").
- Arrastar entre colunas muda a data; arrastar dentro da coluna reordena. Teclado também (`@dnd-kit`).
- Clicar no cartão abre o diálogo da tarefa; o checkbox conclui; "+" no pé da coluna cria já com a data.
- Filtro por tag aplica (client-side). A busca não se aplica a esta visão (a caixa fica oculta nela).
- Toast com **Desfazer** ao mover ("Movida para quarta").

## Contrato backend ⇄ frontend

Comandos Tauri (nomes e formas fixos; tipos em `tauri2/src/lib/api.ts`):

- `list_week(from: String /* YYYY-MM-DD */, days: i64) -> WeekData`
  - `overdue`: pendentes ativas e vivas com `due_date` < hoje (independe de `from`).
  - `days`: um item por dia de `from` a `from + days - 1`, com todas as tarefas vivas do dia
    (pendentes por `position`, depois concluídas).
  - `undated`: ativas, vivas, pendentes, sem `due_date`, por `position`.
  - Cada tarefa é um `TaskDto` completo (tags, progresso de subtarefas).
- `move_task(id: i64, date: Option<String>, index: i64) -> ()`
  - Define `due_date = date` (`None` = sem data) e posiciona a tarefa no `index` entre as **pendentes** da coluna
    destino (sem contar a própria tarefa). Uma transação só. Reinicia `reminded_at` se a data mudou.
  - Emite `tasks-changed`. Mantém hora, prioridade, tags, recorrência.

## Frontend

- Item **Semana** na sidebar (`CalendarRange`) e novo valor `"week"` em `view` no `App.tsx`.
- `tauri2/src/components/week/`: `week-view.tsx` (janela, navegação, DndContext), `week-column.tsx`,
  `week-card.tsx`. O cartão reaproveita `PriorityDot`, `SubtaskProgress`, `TagChip`, hora e ícone de repetição.
  Extrair um cartão compartilhado com `task-row` fica para quando o kanban chegar.
- Arrastar com `@dnd-kit/core` + `@dnd-kit/sortable` (eventos de ponteiro: evita o conflito do HTML5 drag-and-drop
  com o tratamento de arquivos soltos do Tauri no Windows). Auto-scroll horizontal nas bordas.
- Animação: cartão levantado no `DragOverlay` (escala, giro leve, sombra), vizinhos abrem espaço (transform do
  dnd-kit), coluna destino realçada, contador animado (`AnimatedCount`), entrada/saída de cartões com
  `AnimatePresence`. Respeita "reduzir movimento".

## Testes

- Automático: `move_task` e `list_week` no core (`cargo test`), `tsc` e build.
- Manual (só no app): arrastar entre colunas e dentro delas, auto-scroll, teclado, janela estreita (720 px),
  temas claro e escuro, Desfazer.
- macOS não testado.

## Fora da v1

Kanban por estágio (campo `stage`), concluir arrastando para uma coluna, múltiplos quadros, limite de WIP.

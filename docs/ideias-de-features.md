# Ideias de features para o Prumo

Levantamento de possíveis features, divididas em básico, intermediário e inovador.

**Já existem no app:** tarefas com data, notas e anexos; visões Hoje/Amanhã/Todas/Concluídas; tema claro e escuro; SQLite local; reordenação; criação de tarefas por voz com caixa de entrada e Claude Code para interpretar.

## Básico

| Feature | Exemplo |
|---|---|
| **Busca** | Digitar "dentista" filtra título e notas. |
| **Subtarefas / checklist** | "Mudança" → embalar livros, pedir caminhão, trocar endereço. |
| **Prioridade** | Marcar como alta, média ou baixa, com cor ou ícone na linha. |
| **Tarefas atrasadas** | Seção "Atrasadas" em vermelho no topo de Hoje. |
| **Tags ou listas** | `#trabalho`, `#casa`, com filtro na sidebar. |
| **Recorrência** | "Toda segunda", "todo dia 5", "a cada 2 semanas". |
| **Desfazer** | Toast "Tarefa concluída — Desfazer" por alguns segundos. |
| **Atalhos de teclado** | `N` nova tarefa, `Espaço` conclui, `⌘K` busca. |
| **Lembrete com hora** | Data e hora, com notificação nativa do sistema. |
| **Arquivar / lixeira** | Excluir manda para a lixeira por 30 dias. |

## Intermediário

| Feature | Exemplo |
|---|---|
| **Visão Semana / Calendário** | Grade de 7 dias; arrastar a tarefa de segunda para quarta. |
| **Quick-add global** | Atalho `⌥Space` abre uma janelinha em qualquer app para digitar ou falar a tarefa. |
| **Ícone na barra de menu / tray** | Mostra "3 tarefas hoje" e permite concluir sem abrir a janela. |
| **Projetos** | Projeto "Viagem" agrupa tarefas, com barra de progresso 4/10. |
| **Linguagem natural no texto** | Digitar "reunião sexta 14h #trabalho !alta" já preenche tudo, sem precisar de voz. |
| **Templates** | "Checklist de viagem" cria 12 tarefas de uma vez. |
| **Estimativa de tempo** | Cada tarefa tem 30min, e Hoje mostra "total: 5h10". |
| **Revisão diária / semanal** | Ao abrir de manhã: "Você tem 6 tarefas, 2 atrasadas. Reagendar?" |
| **Exportar / importar** | CSV, JSON, Markdown, ou importar do Todoist. |
| **Backup e sincronização opcional** | Pasta do iCloud, Dropbox ou Syncthing, mantendo o "sem conta". |
| **Notificação de resumo** | Todo dia às 8h: "Hoje: 4 tarefas, a primeira é dentista às 9h". |

## Inovador

Muitas aproveitam o que o app já tem: voz local, Claude Code e dados locais.

| Feature | Exemplo |
|---|---|
| **Servidor MCP / CLI** (já citado no README) | No terminal, `prumo add "revisar PR amanhã"`. Claude Code ou Codex criam e listam tarefas durante o trabalho. |
| **Tarefas vindas do código** | Em um repositório, o agente encontra um `TODO` e oferece "Criar tarefa no Prumo com link para arquivo:linha". |
| **Voz multi-tarefa** | "Preciso ligar pro banco, comprar café e revisar o contrato até quinta" cria 3 tarefas separadas na caixa de entrada. |
| **Quebrar tarefa com IA** | "Lançar o site" → o Claude sugere 6 subtarefas; aceitar ou rejeitar cada uma. |
| **Planejador do dia por IA** | "Tenho 4h livres hoje": o app sugere uma ordem com base em prioridade, estimativa e prazo. |
| **Captura por contexto** | Atalho que pega a seleção de texto ou a URL da aba ativa e cria a tarefa com o link anexado. |
| **Tarefas por e-mail ou imagem** | Arrastar um print ou PDF; a IA extrai "pagar boleto R$ 230 até dia 12". |
| **Voz para comandos** | "Adia tudo de hoje para amanhã", "conclui a tarefa do dentista", "o que tenho na quinta?". |
| **Modo foco** | Escolhe uma tarefa; a tela mostra só ela e um timer (pomodoro); o tempo gasto é registrado. |
| **Resumo semanal gerado** | "Você concluiu 23 tarefas e adiou a 'declaração' 4 vezes. Quer quebrá-la em partes?" |
| **Detecção de procrastinação** | Tarefa adiada 3 vezes recebe um aviso: dividir, delegar ou excluir? |
| **Tarefas com localização** | "Comprar pilhas" lembra quando você estiver perto do mercado. |
| **Diário automático** | A aba Concluídas vira um log pesquisável: "o que eu fiz em outubro?". |

## Ordem sugerida

1. **Servidor MCP / CLI:** combina com a proposta local e já está pendente no README.
2. **Quick-add global + tray:** vira hábito porque dispensa abrir a janela.
3. **Recorrência, subtarefas, busca e lembretes:** a base que todo mundo espera.
4. **Voz multi-tarefa e quebra de tarefa por IA:** reaproveitam o pipeline de voz já existente.

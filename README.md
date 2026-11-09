<p align="center">
  <img src="branding/app-icon.svg" alt="Prumo" width="128">
</p>

<h1 align="center">Prumo</h1>

<p align="center">
  Tarefas de hoje e de amanhã, em um app desktop leve para macOS e Windows.
</p>

> **Status: em desenvolvimento inicial.** Testado apenas no macOS. O Windows ainda não foi testado.

## O que faz

- Tarefas com data, notas e anexos, organizadas em Hoje, Amanhã, Todas e Concluídas.
- Tema claro e escuro.
- Dados locais em SQLite, sem conta e sem nuvem.
- **Criação de tarefas por voz:** você fala, a transcrição roda localmente e o Claude Code (via `claude -p`) extrai o título e a data. A tarefa entra numa caixa de entrada para você conferir.
- **CLI e servidor MCP:** o binário `prumo-cli` (crate `cli/`) permite criar e consultar tarefas pelo terminal ou por agentes como Claude Code e Codex. Tarefas criadas assim caem na caixa de entrada para você aprovar, e não há comando de exclusão. O app se atualiza sozinho quando outro processo grava no banco.

## Stack

- **Tauri 2** (Rust) com interface em **React + TypeScript + Tailwind v4 + shadcn/ui**. Sem Electron.
- **`core/`**: crate Rust com o SQLite (tarefas, anexos, caixa de entrada).
- **Transcrição:** modelo Parakeet em ONNX via [`transcribe-rs`](https://github.com/cjpais/transcribe-rs), reaproveitando modelos já baixados pelo [Handy](https://github.com/cjpais/Handy) (somente leitura).

## Estrutura

```
core/       banco de dados e regras (Rust)
cli/        binário `prumo-cli`: CLI e servidor MCP
tauri2/     aplicativo (Tauri + React)
branding/   logo e opções de ícone
```

## Rodando em desenvolvimento

Requisitos: [Rust](https://rustup.rs), Node.js e, para a voz, o Handy com um modelo Parakeet baixado e o [Claude Code](https://claude.com/claude-code) instalado e autenticado.

```sh
cd tauri2
npm install
npm run tauri dev
```

Testes do `core`: `cd core && cargo test`.

## CLI e MCP

```sh
cd cli && cargo build --release   # ou: npm run prepare-cli, em tauri2/
prumo-cli add "revisar PR" --due amanhã --tag trabalho
prumo-cli list --inbox          # também: --today, --tomorrow, --all, --done, --overdue
prumo-cli show 12              # notas, subtarefas e o caminho das imagens coladas
prumo-cli done 12
prumo-cli search dentista
```

Para o Claude Code usar o Prumo como servidor MCP (o app mostra o comando pronto em Configurações → Agentes):

```sh
claude mcp add prumo -- /caminho/para/prumo-cli mcp
```

Tools: `add_task`, `list_tasks`, `get_task`, `complete_task`, `search_tasks`, `update_task`, `add_subtask`, `list_tags`. Defina `PRUMO_DATA_DIR` para usar outro banco.

### Notas em markdown e imagens

As notas da tarefa são um editor markdown (Tiptap): títulos, listas, checklist, citação, código, links, tabelas e
um modo markdown puro. O texto continua sendo markdown simples no banco, e só é reescrito quando você edita.
O diálogo tem dois layouts: compacto na janela padrão e expandido (editor amplo com painel lateral) a partir de
1280×760.

`Ctrl+V` com uma imagem na área de transferência salva o arquivo como `image-N.png` em `attachments/` (dentro da
pasta de dados) e deixa o token `[Image #N]` no texto, que o editor mostra como miniatura. O banco guarda só o
caminho. A tool `get_task` devolve o texto da tarefa e embute as imagens na resposta, rotuladas com o mesmo número
(até 5 por chamada, 5 MB cada); as que passam do limite vão só com o caminho, que o agente abre com a ferramenta de
leitura de arquivos. Depois de atualizar o Prumo, reinicie a sessão do agente para ele enxergar a tool nova.

Testes do front: `cd tauri2 && npm test`.

## Observações

- O `transcribe-rs` 0.3.12 não compila com `ort` mais novo que `2.0.0-rc.12`; a versão está fixada no `Cargo.lock`.

## Licença

[MIT](LICENSE)

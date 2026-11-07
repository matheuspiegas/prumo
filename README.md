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

## Stack

- **Tauri 2** (Rust) com interface em **React + TypeScript + Tailwind v4 + shadcn/ui**. Sem Electron.
- **`core/`**: crate Rust com o SQLite (tarefas, anexos, caixa de entrada).
- **Transcrição:** modelo Parakeet em ONNX via [`transcribe-rs`](https://github.com/cjpais/transcribe-rs), reaproveitando modelos já baixados pelo [Handy](https://github.com/cjpais/Handy) (somente leitura).

## Estrutura

```
core/       banco de dados e regras (Rust)
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

## Observações

- O `transcribe-rs` 0.3.12 não compila com `ort` mais novo que `2.0.0-rc.12`; a versão está fixada no `Cargo.lock`.
- A integração por servidor MCP / CLI (para Claude Code e Codex criarem tarefas) ainda não existe.

## Licença

[MIT](LICENSE)

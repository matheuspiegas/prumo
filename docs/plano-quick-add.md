# Plano: Quick-add global

Atalho global que abre uma janelinha flutuante em qualquer app para criar uma tarefa por texto ou voz. Deve funcionar no Windows e no macOS.

## Decisões

1. **Atalho padrão:** `Alt+Space` no macOS e `Ctrl+Alt+Space` no Windows (`Alt+Space` abre o menu de sistema e conflita com o PowerToys Run).
2. **Fechar a janela principal esconde o app** (continua em segundo plano, com tray). Só "Sair" no tray encerra.
3. **Fora da v1:** aparecer sobre apps em tela cheia no macOS (NSPanel / `tauri-nspanel`), parsing de linguagem natural e captura de contexto.

## Estado atual (antes da feature)

- Existe um atalho global de voz (`voice::register_shortcut`, `settings.shortcut`) que emite `voice-toggle` para a janela `main`.
- Só existe a janela `main`; a capability `default.json` só vale para ela.
- Não há tray: fechar a janela encerra o app e o atalho global morre junto.
- O handler do atalho não distingue qual atalho foi pressionado.

## Escopo da v1

Um atalho abre uma janela com um campo de texto. Enter cria a tarefa, Esc fecha, clicar fora fecha. Botão de microfone reaproveita o pipeline de voz. A tarefa vai para a caixa de entrada, ou direto para "Hoje" se `auto_approve` estiver ligado.

## Etapas

### 1. Segundo plano (comum)
- Interceptar `CloseRequested` da `main`: `hide()` + `prevent_close()`.
- Tray com "Abrir Prumo", "Nova tarefa rápida" e "Sair".
- `tauri-plugin-single-instance`: nova execução só foca a janela existente.
- macOS: `ActivationPolicy::Accessory` ao esconder, `Regular` ao mostrar.
- Opcional: `tauri-plugin-autostart`.

### 2. Janela `quickadd`
- Criada no `setup`, escondida, para abrir instantâneo.
- `decorations: false`, `alwaysOnTop`, `skipTaskbar`, `resizable: false`, centralizada, ~560×64 px, fundo transparente com cantos arredondados via CSS.
- Esconde no `Focused(false)` e no Esc.
- Frontend: entrypoint próprio e pequeno (`quickadd.html`), reaproveitando `api.ts`, tema e `use-voice`.
- Capability separada, com só as permissões necessárias.

### 3. Dois atalhos
- Novo campo `quick_add_shortcut` em `settings.rs`, com UI de captura em Configurações (replicar a do atalho de voz).
- `register_shortcut` registra os dois; o handler compara o atalho recebido: voz emite `voice-toggle`, quick-add faz `show()` + `set_focus()` + emite `quickadd-open`.
- Validar conflito entre os dois e mostrar erro claro quando o sistema recusar.

### 4. Salvar e dar feedback
- Comando `quick_add_task(title)` usando `add_task_from(..., "rápida")`.
- Emitir evento para a janela principal atualizar lista e contagens.
- Fechar a janelinha e mostrar confirmação curta.

### 5. Voz no quick-add
- `VoiceState` já é global no Rust; a janela nova chama `voice_start` / `voice_stop`.
- O atalho de voz passa a funcionar sem depender da janela principal carregada.

### 6. Ajustes específicos do macOS
- Activation policy, foco (`NSApp.activate`), `macOSPrivateApi` para transparência, template image no tray.

## Diferenças Windows x macOS

| Ponto | Windows | macOS |
|---|---|---|
| Foco | `set_focus` costuma funcionar a partir do hotkey | Precisa ativar o app, senão o campo não recebe teclas |
| Transparência | Funciona, sombra irregular | Exige `macOSPrivateApi: true` |
| Tray | Bandeja | Barra de menu, ícone monocromático (template) |
| Tela cheia | `alwaysOnTop` basta | Adiado (NSPanel) |

## Testes

- Automático: `quick_add_task` e validação de conflito de atalhos (`cargo test`), `tsc` no frontend.
- Manual, nos dois sistemas: foco entre apps, esconder ao perder foco, transparência, tray, segunda instância.
- O macOS não pôde ser testado no desenvolvimento (feito no Windows).

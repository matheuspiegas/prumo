# Prumo: estado do projeto

Documento de registro do que foi feito, das decisões tomadas e do problema em aberto.
Atualizado em 2026-11-07. Onde algo **não foi verificado**, está marcado como tal.

## Objetivo

App desktop nativo (macOS e Windows) para tarefas de hoje e de amanhã: criar tarefa, definir data,
guardar anexos, tema claro e escuro, SQLite local, consumo mínimo de recursos (sem Electron) e
criação de tarefas por voz. Integração com Claude Code e Codex (MCP/CLI) está planejada, mas **não existe ainda**.

Repositório: https://github.com/matheuspiegas/prumo (público, licença MIT).

## O que foi feito

### Escolha do framework

Foram comparados Slint, Tauri 2 e GPUI (e outros, só no papel). Prototipamos Slint e Tauri 2 com o mesmo
`core` SQLite. Medições no macOS, uma execução cada:

| | Slint | Tauri 2 + React |
|---|---|---|
| Binário release | 16,9 MB | 5,6 MB |
| RAM ociosa | ~70 MB | ~172 MB (78 MB do app + ~94 MB do WebKit) |

Escolhemos **Tauri 2** pelo visual (a interface é web) e removemos o protótipo Slint. O GPUI foi descartado
(API instável, pouca documentação). O protótipo Tauri **não** é "sem webview": usa o WebKit/WebView2 do sistema.

### Stack atual

- **Tauri 2** (Rust) com interface **React + TypeScript + Tailwind v4 + shadcn/ui** (estilo `base-nova`,
  sobre Base UI) e ícones **Lucide**.
- **`core/`**: crate Rust com SQLite (`rusqlite`), compartilhado pelo app. Tem tarefas, anexos, caixa de
  entrada (`source`/`status`), aprovação e reordenação. Banco em modo WAL.
- Dados em `~/Library/Application Support/Prumo` (macOS) e `%APPDATA%\Prumo` (Windows).
  Pode ser trocado com a variável `PRUMO_DATA_DIR`.
- Interface: sidebar (Caixa de entrada, Hoje, Amanhã, Todas, Concluídas), criação rápida, diálogo de
  tarefa com data (Calendar + Popover), notas e anexos (arrastar e soltar ou botão), tema claro/escuro,
  animações com a biblioteca `motion`, tela de Configurações.

### Logo e ícones

Escolhida a opção 6 (monograma P: a haste é o fio de prumo e o bojo é uma caixa de seleção com check).
Fonte em `branding/app-icon.svg`; ícones de macOS e Windows gerados com `tauri icon` em
`tauri2/src-tauri/icons/`. As outras 17 opções ficam só localmente (fora do git).
**Defeito conhecido, não corrigido:** a ponta do check encosta no aro do P.

### Criação de tarefas por voz

Fluxo: gravar (cpal) → transcrever localmente → interpretar com `claude -p` → tarefa na caixa de entrada
(origem `voz`). Atalho global `⌘⇧Espaço` / `Ctrl+Shift+Espaço` (configurável), botão no cabeçalho.

- **Transcrição:** reaproveita modelos já instalados no **Handy** (somente leitura). Dois motores:
  - **Parakeet ONNX** (pasta; formato antigo do Handy), via `transcribe-rs`. Sempre disponível.
  - **ggml** (`.bin` do Whisper e `.gguf`; formato atual do Handy), via `transcribe-cpp`, o mesmo motor do
    Handy. Fica atrás da feature Cargo `ggml` (exige CMake e compilador C++), **desligada por padrão**.
    O build do Windows a liga; o do macOS não (o CMake não está instalado na máquina de desenvolvimento).
- **Descoberta de modelos:** procura na pasta do Handy (no Windows, `Roaming` e `Local`) e no cache do
  HuggingFace (repositórios `handy-computer/*-gguf`). Modelos que o build não consegue usar aparecem
  desabilitados, com o motivo, e a tela mostra onde procurou.
- **Interpretação:** `claude -p` com saída estruturada (`--json-schema`), sem ferramentas e sem MCP.
  Padrão `haiku` com esforço `low`, configurável em Configurações. Medido uma vez no macOS: ~3,6 s e
  ~US$ 0,0004 por chamada. Se a CLI faltar ou falhar, a tarefa é criada com o texto bruto.
- **Isolamento:** a transcrição roda em um processo separado (`prumo --stt-worker`), para uma queda do
  motor nativo não fechar o app. O código de saída é registrado no log.
- **Log:** `prumo.log` em `<pasta de dados>/logs/`, com cada etapa da voz e os pânicos de Rust.
  Configurações → Diagnóstico abre a pasta. O log de início registra `avx/avx2/fma/avx512f` da CPU.
- **Configurações:** modelo de transcrição, atalho, modelo e esforço do Claude, caminho da CLI, aprovação
  automática, tema.

### Build do Windows

Não dá para gerar instalador de Windows a partir do macOS de forma confiável. Há um workflow manual do
GitHub Actions (`.github/workflows/build-windows.yml`, `workflow_dispatch`) que compila em `windows-latest`
com `--features ggml` e `TRANSCRIBE_CMAKE_ARGS=-DGGML_NATIVE=OFF`, e publica os instaladores como
artefatos: NSIS (`.exe`, ~8 MB) e MSI (~21 MB). Duração: 6 a 13 min (13 min quando o cache do Rust é
invalidado). Os instaladores **não são assinados** (aviso do SmartScreen).

### Repositório

Público, com `.gitignore` que bloqueia banco, `node_modules`, `target`. Commits com o e-mail `noreply` do
GitHub. Foi feita uma varredura de segredos antes do primeiro push (nada encontrado).

## Incidente já tratado: o app fechava ao usar a voz no Windows

**Sintoma:** ao criar tarefa por voz no Windows, o app fechava sozinho. Não havia log.

**Diagnóstico:** adicionamos o log. A última linha antes do fechamento era `stt: carregando modelo …
Qwen3-ASR-1.7B-Q8_0.gguf`, sem `PÂNICO` nem erro: queda **nativa** no motor ggml (ou morte por memória).
O log também confirmou que o Prumo achou o modelo no cache do HuggingFace e que o microfone funcionou
(48 kHz, 2 canais, F32).

**Hipótese (não confirmada):** o crate `transcribe-cpp-sys` só fixa o piso de CPU portátil
(`GGML_NATIVE=OFF`) no macOS. No Windows, o build estático era otimizado para a CPU do servidor do GitHub
(provavelmente com AVX-512), gerando "instrução ilegal" em CPUs sem essas instruções.

**Correções aplicadas, ambas ao mesmo tempo:**
1. `-DGGML_NATIVE=OFF` no workflow do Windows (piso AVX2).
2. Transcrição em processo separado, com o código de saída no log.

**Resultado:** o usuário relatou que "deu certo". **Não sabemos qual das duas correções resolveu**, porque a
linha de CPU do log não foi enviada nem o app voltou a cair para comparar. A hipótese da CPU segue sem prova.

## Problema em aberto: a transcrição por voz demora bastante no Windows

O usuário usa o **Qwen3-ASR de ~2 GB** (1,7B parâmetros, quantização Q8_0) no Windows. Funciona, mas
**demora bastante**. **Não há números medidos**: o log ainda não separa tempo de carga e de inferência, e os
tempos reais do usuário não foram enviados.

**Hipóteses (nenhuma medida):**
- O Qwen3-ASR é um modelo do tipo "linguagem" (decodificador grande); na CPU é bem mais lento que modelos
  de transcrição dedicados (Parakeet, Whisper).
- O modelo de ~2 GB é **recarregado a cada gravação** (por desenho: o processo auxiliar descarrega tudo ao
  terminar, para não ocupar RAM com o app parado).
- `GGML_NATIVE=OFF` troca desempenho por portabilidade (piso AVX2). Se a CPU do usuário tiver AVX-512, perde-se
  parte do ganho possível.
- O motor está sem GPU (o build estático não inclui Vulkan). O Handy, no Windows x86_64, usa backends
  dinâmicos e Vulkan.
- Depois da transcrição ainda há o `claude -p` (~4 s medidos no macOS).

**Opções discutidas, em ordem de custo (nada disso foi implementado):**
1. Usar um modelo mais rápido já suportado pelo Handy (Parakeet TDT 0.6B v3 GGUF ou Whisper small),
   sem mudar código. No macOS o Parakeet ONNX levou 1,25 s para 7 s de fala; no Windows com ggml, **não medido**.
2. Manter o modelo carregado por alguns minutos (tempo configurável), trocando RAM por latência.
3. Ajustar `n_threads` e passar dica de idioma ao motor (`RunOptions.language`). Ganho incerto.
4. Habilitar Vulkan e backends dinâmicos, como o Handy. O que mais acelera, mas mexe no empacotamento
   (DLLs por ISA) e exige o SDK do Vulkan no CI.

**Dados necessários para decidir:** do `prumo.log` do usuário, (a) a primeira linha, com
`cpu[avx=… avx2=… fma=… avx512f=…]`, e (b) as linhas de uma gravação lenta, de `voz: iniciando gravação`
até `voz: tarefa criada`. Se necessário, o próximo build deve registrar separadamente carga do modelo e
inferência.

## O que ainda não foi verificado

- Windows: só a voz foi exercitada (microfone, descoberta de modelo, transcrição). Não foi testado: atalho
  global, anexos, dados em `%APPDATA%\Prumo`, instalação do NSIS ponta a ponta além do uso da voz.
- A marcação "em uso no Handy" para modelos `.gguf` usa comparação tolerante, porque o formato exato do
  `selected_model` do Handy no catálogo novo não é conhecido. Se errar, só muda o pré-selecionado.
- Reconhecimento de repositórios do HuggingFace fora de `handy-computer/` usa palavras-chave (heurística).
- O motor `ggml` nunca foi compilado nem testado no macOS.

## Limitações e pendências conhecidas

- Uma tarefa por fala: se o usuário ditar duas coisas, só a primeira vira tarefa.
- Servidor MCP e CLI (para Claude Code e Codex criarem tarefas) **não existem**. O Codex nem está instalado
  na máquina de desenvolvimento, então suas flags nunca foram verificadas.
- Instaladores sem assinatura (Windows SmartScreen; no macOS, Gatekeeper).
- O `transcribe-rs` 0.3.12 não compila com `ort` acima de `2.0.0-rc.12`: a versão está fixada no `Cargo.lock`.
- Sem ícone na barra de menus nem notificações nativas (planejados).
- Ideias de produto estão em `docs/ideias-de-features.md`.

## Como construir e rodar

- Desenvolvimento (macOS): `cd tauri2 && npm install && npm run tauri dev`.
- Testes: `cd core && cargo test` e `cd tauri2/src-tauri && cargo test --lib`; tipos: `cd tauri2 && npx tsc --noEmit`.
- Windows: aba Actions → "Build Windows" → Run workflow; os instaladores saem como artefatos da execução.
- Logs: `~/Library/Application Support/Prumo/logs/prumo.log` (macOS) e `%APPDATA%\Prumo\logs\prumo.log` (Windows).

## Lições do processo

- Duas pessoas/sessões alteraram a mesma árvore ao mesmo tempo. Um commit ficou com o `voice.rs` novo e o
  `audio.rs` antigo, e o build do Windows falhou (E0061). Commits devem levar juntos os arquivos que dependem uns
  dos outros, e o CI só enxerga o que foi commitado.
- No Windows o app não tem console: sem log em arquivo, uma queda nativa não deixa rastro.
- Verificar o resultado real de uma execução do CI antes de afirmar sucesso (uma consulta feita cedo demais
  devolveu `conclusão` vazia).

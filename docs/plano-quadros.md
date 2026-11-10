# Plano: Quadros (quadro branco infinito)

Uma aba nova, **Quadros**, com vários quadros brancos infinitos no estilo Excalidraw, salvos localmente, para
desenhar fluxos, diagramas e anotações visuais. Cada quadro tem nome, abre numa tela própria e fica guardado.

Status: **proposta para análise**. Nada foi implementado. Onde algo **não foi verificado**, está marcado.

## Resposta curta

- **É possível?** Sim.
- **É muito complexo?** Depende do caminho. **Embutindo o Excalidraw** (que é uma biblioteca React, licença MIT), é
  uma feature de tamanho **médio**: quase tudo que você descreveu já vem pronto (quadro infinito, formas, setas que
  grudam nas formas, texto, 3 tipos de letra, desfazer, exportar). O trabalho real é integrar, salvar, organizar
  vários quadros, montar a biblioteca de formas de programação e ajustar o visual. **Construir um canvas do zero** seria
  **muito grande** (semanas, com muitos detalhes difíceis: zoom e pan suaves, seleção, setas conectadas, desfazer, texto
  editável), e não vale a pena.
- **Recomendação:** embutir o Excalidraw, carregado só quando a aba é aberta.

## Decisão 1: o motor do quadro

| | Excalidraw embutido | tldraw | Canvas próprio |
|---|---|---|---|
| Licença | **MIT** (verificado no npm) | licença própria, **não** MIT (`SEE LICENSE IN LICENSE.md`); **não li**, precisa ler antes | nossa |
| Esforço | médio | médio | muito grande |
| Visual | o "desenhado à mão" que você citou | mais limpo, menos "esboço" | o que a gente fizer |
| React 19 | sim (verificado: peer `^19.0.0`) | sim | n/a |

O restante do plano assume o **Excalidraw 0.18.1**.

O que **verifiquei** no pacote: aceita React 19; tem tradução `pt-BR`; expõe `initialData`, `onChange(elementos,
estado, arquivos)`, `theme`, `langCode`, `UIOptions`, `renderTopRightUI`, `onLibraryChange`; as fontes dele podem ser
carregadas de uma pasta local (`window.EXCALIDRAW_ASSET_PATH`), então funciona **offline**; contém a criação rápida de
fluxograma (setas que geram o próximo nó).

## Decisão 2: as três fontes

Você pediu: **escrita à mão**, **normal** e **código (monoespaçada)**. O Excalidraw tem um conjunto **fixo** de fontes
(verificado nas constantes do pacote):

| Estilo | Fonte do Excalidraw |
|---|---|
| Escrita à mão | **Excalifont** (a nova) ou Virgil (a antiga) |
| Normal | **Nunito**, Helvetica, Liberation Sans, Lilita One (título) |
| Código | **Cascadia** e **Comic Shanns** (as duas são monoespaçadas) |

**Limitação importante:** não existe API para registrar uma fonte nossa. Ou seja, **a Plus Jakarta Sans não entra no
quadro sem alterar o pacote**. Opções:

1. **Usar a Nunito como "Normal"** (recomendado para a v1). É uma sans arredondada, visualmente próxima da Jakarta, e
   já vem pronta.
2. Aplicar um *patch* no pacote (`patch-package`) para registrar a Jakarta. Funciona, mas é frágil: a cada atualização
   do Excalidraw o patch pode quebrar.
3. Fazer um fork do Excalidraw. Descartado: custo de manutenção alto demais.

Para "Código", sugiro a **Cascadia** (monoespaçada de verdade, a mais próxima do que você descreveu). A Comic Shanns
também é monoespaçada, mas com formato de "história em quadrinhos". **Não verifiquei** quais rótulos o seletor de fonte
mostra em português nem quais fontes ele destaca por padrão; isso entra no spike.

Fontes a empacotar para funcionar offline: ~**0,4 MB** (sem as fontes de fallback para chinês/japonês, que somam ~12 MB
e dá para omitir; caracteres fora do conjunto caem na fonte do sistema).

## Decisão 3: formas

**O que já vem no Excalidraw:** retângulo, losango, elipse, seta, linha, desenho livre, texto, imagem, moldura,
borracha e a criação rápida de fluxograma. Retângulo, losango e elipse aceitam **texto dentro** (o texto acompanha a
forma). Setas se conectam às formas e as seguem quando você move.

**O que falta** (formas de programação e diagramas), que nós montamos como uma **biblioteca embutida "Prumo"**, carregada
por padrão e organizada por categoria:

- **Fluxograma:** terminador (início/fim), processo, decisão, entrada/saída (paralelogramo), documento, subprocesso,
  conector, preparação (hexágono).
- **Programação e arquitetura:** banco de dados (cilindro), servidor, fila/mensageria, API/gateway, cache, usuário/ator,
  navegador/tela, arquivo, container, nuvem, função.
- **UML básico:** caixa de classe, ator, nota.
- **Geométricas extras:** triângulo, estrela, chave `{ }`, seta grossa.

Além disso, o usuário poderá **importar bibliotecas `.excalidrawlib`** da comunidade (existe um acervo público). A
licença de cada uma varia; por isso não as empacotamos, só deixamos importar.

**Limitação honesta:** as formas que não são retângulo, losango ou elipse (cilindro, documento, nuvem...) são
**grupos de peças**, não formas nativas. O texto delas é um elemento separado, que o usuário posiciona por cima, em vez
de "grudar" na forma. Para as mais usadas, desenho cada uma de modo que o rótulo fique natural (por exemplo, um
retângulo com cantos como base e a decoração por cima).

## Dados e armazenamento

Mesmo raciocínio dos anexos de imagem: **arquivos em pasta, banco só com os metadados**.

- **Banco (migração do schema 2 para 3):** tabela `boards` com `id`, `name`, `created_at`, `updated_at`, `position`
  (ordem na lista) e `deleted_at` (para uma lixeira, se escolhermos).
- **Arquivos** em `<pasta de dados>/boards/`:
  - `{id}.excalidraw`: a cena serializada (JSON do Excalidraw, com as imagens embutidas).
  - `{id}.png`: miniatura pequena para a grade, gerada ao salvar.
  - `library.json`: as formas que o usuário importar.
- **Gravação segura:** escreve num arquivo temporário e renomeia (não deixa o quadro pela metade se o app fechar).
- **Salvar sozinho:** a cada alteração (com espera de ~1 s), mais forçar ao trocar de quadro e ao fechar o app.
  Indicador discreto "Salvo".
- **Imagens grandes:** na v1 ficam dentro do JSON; mostramos aviso se o quadro passar de um tamanho limite (por exemplo
  25 MB). Separar as imagens em arquivos fica para depois, se virar problema.

Backend: comandos novos no estilo atual (`list_boards`, `create_board`, `rename_board`, `duplicate_board`,
`delete_board`, `read_board`, `write_board`), com testes de CRUD e da migração, e o app atualiza a lista quando o banco
muda, como já faz com as tarefas.

## Interface

- Item **Quadros** na sidebar (ao lado de Semana).
- **Lista de quadros:** grade de cartões com miniatura, nome e "atualizado em". Botão **Novo quadro**. Clicar abre.
- **Quadro aberto:** ocupa a tela toda da área principal. Barra fina no topo: **← Quadros**, nome editável, status
  "Salvo", menu (duplicar, exportar PNG, SVG ou `.excalidraw`, excluir).
- **Tema:** segue o claro/escuro do app. As cores e o raio de 2px do Excalidraw usam variáveis próprias, então ajusto o
  visual dele para combinar com o grafite-ambar.
- **Idioma:** `pt-BR`.

## Riscos e pontos a validar (spike)

Antes de construir, um **spike curto** para confirmar o que não consigo garantir só lendo:

1. **Soltar arquivos de imagem no quadro.** O Tauri intercepta o arrastar-e-soltar de arquivos da janela (é por isso
   que o diálogo de tarefa usa um evento próprio). Isso pode impedir o "arrastar imagem para o quadro". **Colar
   (`Ctrl+V`)** deve funcionar. Se o arrastar não funcionar, trato com um comando próprio, ou deixo para uma versão
   seguinte.
2. **Peso:** os arquivos JavaScript do Excalidraw somam ~**2,6 MB** (sem comprimir; o `index.js` tem 0,48 MB, ~0,15 MB
   comprimido; **não medi o total comprimido**). Carregado só ao abrir a aba (`React.lazy`), não afeta a abertura do app.
3. **Memória:** o Prumo preza consumo baixo. Vou medir a RAM com um quadro aberto e **desmontar** o canvas ao sair da aba.
4. **Fontes offline:** copiar as fontes para dentro do app e apontar `EXCALIDRAW_ASSET_PATH`; confirmar no Windows e no
   macOS.
5. **Atalhos:** o Excalidraw trata o teclado quando o quadro está focado; confirmar que não colide com os atalhos do
   app (a sidebar com `Ctrl+B` já foi corrigida para respeitar teclas tratadas).
6. **WebView2 e WebKit:** testar o desempenho do desenho e do zoom nos dois motores (o app roda em ambos).

## Fases

0. **Spike:** quadro embutido numa tela de teste, no Windows: fontes offline, tema, colar imagem, soltar arquivo,
   medir peso e RAM. Decide se seguimos com o Excalidraw.
1. **Dados:** migração, tabela `boards`, comandos, gravação em arquivo, testes.
2. **Lista e quadro:** item na sidebar, grade de quadros, criar/renomear/duplicar/excluir, abrir o quadro, salvar
   sozinho, miniaturas.
3. **Fontes e visual:** os três estilos de letra, tema claro/escuro, ajuste das cores e do raio.
4. **Biblioteca de formas "Prumo":** as categorias acima e a importação de `.excalidrawlib`.
5. **Acabamento:** exportar, avisos de tamanho, README, testes e um roteiro de teste manual no app; PR e build do
   Windows como nos anteriores.

**Fase futura, fora deste plano:** o agente (MCP) ler os quadros e criar diagramas. Uma ideia boa: o agente escreve um
diagrama em **Mermaid** e o app converte em desenho no quadro (existe um pacote do próprio Excalidraw para isso).

## Testes

- **Rust:** CRUD de `boards`, migração 2→3 preservando os dados, gravação atômica.
- **Front (vitest):** lógica de salvar com espera, leitura e escrita da cena, lista de quadros.
- **No app:** roteiro manual (criar, desenhar, trocar de quadro, fechar e reabrir, exportar, tema, janela pequena),
  como já fizemos com o editor de notas.

## Decisões que preciso de você

1. **Motor:** seguimos com o **Excalidraw embutido**? (recomendado)
2. **Fonte "Normal":** **Nunito** na v1 (recomendado) ou aceitar o risco do patch para usar a **Plus Jakarta Sans**?
3. **Fonte de código:** **Cascadia** (recomendado) ou Comic Shanns?
4. **Excluir quadro:** só com confirmação, ou com **lixeira** (reaproveita a da tarefa, mais trabalho)?
5. **Imagens:** na v1, **colar** sim; **arrastar arquivo** só se o spike mostrar que dá simples. Pode ser assim?
6. **Biblioteca de formas:** a lista de categorias acima está boa, ou falta/sobra algo para os seus diagramas?
7. **Ordem de entrega:** terminamos primeiro o **tema (Jakarta + 2px)** e fazemos o PR dele; este trabalho sai numa
   branch separada depois. Confirma?

## Respostas
1. Sim
2. vamos de nunito
3. cascadia
4. Vamos por enquanto sem lixeira, só com confirmação
5. sim, mas deixe o arrastar em aberto, é interessante.
6. sim, está boa, desde que o usuário possa importar as libs do excalidraw que ele quiser, isso vai ser possível né?
7. sim

## Decisões fechadas e o que mudam no plano

| # | Decisão | Efeito no plano |
|---|---|---|
| 1 | Excalidraw embutido | Segue como descrito. O spike (fase 0) ainda valida antes de investir. |
| 2 | Fonte normal: **Nunito** | Sem patch no pacote; a Jakarta fica só no resto do app. |
| 3 | Fonte de código: **Cascadia** | É a monoespaçada de verdade; a Comic Shanns fica disponível no seletor, sem destaque. |
| 4 | Excluir só com confirmação, **sem lixeira** | A tabela `boards` não precisa de `deleted_at` na v1; o `delete_board` apaga o registro e os arquivos (`.excalidraw` e `.png`) depois da confirmação. Fica fácil acrescentar lixeira depois. |
| 5 | **Colar** imagem sim; **arrastar** em aberto | Arrastar arquivo vira um item aberto do spike (ver abaixo), sem prazo fechado. |
| 6 | Biblioteca de formas boa, **com importação livre** de `.excalidrawlib` | Detalhado abaixo. |
| 7 | Primeiro o tema, depois esta feature | Esta feature sai numa branch própria a partir da `main`, depois do PR do tema. |

### Importar bibliotecas do Excalidraw: é possível?

**Sim.** Verificado no pacote: o formato `.excalidrawlib` é nativo, e a API expõe `loadLibraryFromBlob`,
`updateLibrary` (mescla itens na biblioteca) e `onLibraryChange` (avisa quando ela muda, para a gente gravar).

Um ponto que **muda o jeito de fazer**: o botão "Navegar bibliotecas" do Excalidraw abre o site
libraries.excalidraw.com e, ao clicar em "Add to Excalidraw", o site tenta **voltar para uma página web** (o
`libraryReturnUrl`). Num app desktop não há página para voltar, então esse atalho **não funciona** do jeito web. O que
fazemos:

- Um botão nosso, **"Importar biblioteca"**, na barra do quadro: abre o seletor de arquivo (o app já usa o plugin de
  diálogo), lê o `.excalidrawlib` e chama `updateLibrary` com os itens, abrindo o painel da biblioteca.
- O fluxo para o usuário: baixa o `.excalidrawlib` no site (botão de download) e importa no Prumo.
- **Persistência:** `onLibraryChange` grava tudo em `boards/library.json`, então as bibliotecas importadas ficam
  disponíveis em **todos** os quadros e sobrevivem ao fechar o app. A biblioteca embutida "Prumo" continua separada e
  sempre presente.
- Opcional, se quiser: importar **por link** (colar a URL do `.excalidrawlib`). Exige uma requisição de rede feita pelo
  app (o Rust hoje não tem cliente HTTP), por isso deixo fora da v1.

**O que não verifiquei:** se o painel de biblioteca do Excalidraw embutido já traz um botão próprio de abrir arquivo.
Como o nosso botão garante o caminho, isso não bloqueia nada.

### Arrastar arquivo para o quadro (em aberto)

O Tauri intercepta o arrastar de arquivos sobre a janela, e isso pode impedir o arrastar nativo do navegador de chegar
ao Excalidraw. No spike eu testo. Se não funcionar direto, o caminho é usar o mesmo evento que o diálogo de tarefa já
usa (o Tauri entrega o caminho do arquivo) e inserir a imagem no quadro por código. Isso vale tanto para **imagens**
quanto para soltar um **`.excalidrawlib`** no quadro. Fica como melhoria, sem bloquear a v1.

### Próximo passo

Fechar o PR do **tema (Jakarta e 2px)**. Depois, criar a branch da feature e começar pelo **spike** da fase 0, que só
volta para você com o resultado (peso, memória, fontes offline, arrastar e tema).

## Contrato técnico (implementação)

Fixado antes de começar, para as partes saírem em paralelo sem se atropelar.

### Arquivos e dados

- Pasta: `data_dir()/boards/`. Por quadro: `{id}.excalidraw` (cena em JSON, texto) e `{id}.png` (miniatura).
  Global: `library.json` (itens importados, formato `.excalidrawlib`).
- Banco, **schema 3** (migração `if version < 3`, `SCHEMA_VERSION = 3`):
  `boards(id INTEGER PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`.
- Nome: aparado, não vazio, até 120 caracteres. Sem nome, o padrão é "Quadro sem título" ("Quadro sem título 2", ...).
- Listagem ordenada por `updated_at` decrescente.

### Rust: `core` (módulo novo `core/src/boards.rs`)

- `struct Board { id, name, created_at, updated_at }`.
- `Db`: `list_boards`, `get_board`, `create_board(name: Option<&str>) -> id`, `rename_board`, `touch_board`,
  `delete_board` (só o registro).
- Funções de arquivo (recebem `dir: &Path`): leitura e escrita da cena (**escrita atômica**: arquivo temporário e
  renomear), da miniatura e da biblioteca; `delete_board_files`; `copy_board_files(dir, de, para)`; `boards_dir()`.
- `duplicate`: cria o registro "Cópia de <nome>" e copia os arquivos.

### Rust: comandos Tauri (módulo `tauri2/src-tauri/src/boards.rs`, registrados em `lib.rs`)

`list_boards`, `create_board(name: Option<String>)`, `rename_board(id, name)`, `duplicate_board(id)`,
`delete_board(id)`, `read_board(id) -> Option<String>`, `write_board(id, scene: String)` (valida que é JSON e limita
o tamanho), `write_board_thumbnail` (corpo binário + cabeçalho `x-board-id`, como `add_attachment_bytes`),
`read_board_thumbnail(id) -> bytes`, `read_board_library() -> String`, `write_board_library(library: String)`,
`read_text_file(path) -> String` (só `.excalidrawlib`, `.excalidraw` e `.json`, até 20 MB).
DTO em camelCase: `{ id, name, createdAt, updatedAt, hasThumbnail }`. Evento `boards-changed` ao criar, renomear,
duplicar e excluir (não ao gravar a cena).

### Front-end

- Tipos e chamadas: `Board` e `api.boards.*` em `tauri2/src/lib/api.ts` (já escritos).
- `BoardCanvas` (`tauri2/src/components/boards/board-canvas.tsx`): `{ boardId, onSaveState? }`.
- `PRUMO_LIBRARY_ITEMS` (`prumo-library.ts`): itens da biblioteca embutida.
- Tema do app: `useTheme().resolvedTheme` do `next-themes` (`"light"` ou `"dark"`).

### Quem mexe em quê

| Parte | Arquivos |
|---|---|
| Backend | `core/src/lib.rs` (esquema e `mod`), `core/src/boards.rs`, `tauri2/src-tauri/src/boards.rs`, `tauri2/src-tauri/src/lib.rs` (só `mod` e lista de comandos) |
| Canvas | `components/boards/board-canvas.tsx` e arquivos novos na mesma pasta, `tauri2/scripts/`, a seção `scripts` do `package.json`, estilos do Excalidraw |
| Biblioteca de formas | `components/boards/prumo-library.ts` e seu teste |
| Lista e navegação | `components/boards/boards-view.tsx`, `board-card.tsx`, diálogos, `App.tsx`, `app-sidebar.tsx` |

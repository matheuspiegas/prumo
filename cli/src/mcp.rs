//! Servidor MCP (stdio) sobre a camada `commands`. Não há tool de exclusão.

use std::sync::{Arc, Mutex};

use rmcp::{
    ErrorData, ServerHandler, ServiceExt,
    model::{CallToolResult, ContentBlock},
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    schemars, tool, tool_handler, tool_router,
};
use serde::Deserialize;
use tarefas_core::Db;

use crate::commands::{self, Filter, SOURCE_MCP};

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddTaskArgs {
    /// Título da tarefa.
    pub title: String,
    /// Notas em markdown (opcional). O app mostra num editor markdown: títulos, listas, checklists (`- [ ] item`), tabelas, blocos de código e links funcionam. Texto livre também serve.
    pub notes: Option<String>,
    /// Data de vencimento no formato YYYY-MM-DD (opcional).
    pub due_date: Option<String>,
    /// Etiquetas (opcional).
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListTasksArgs {
    /// Filtro: today | tomorrow | all | done | inbox | overdue. Padrão: today.
    pub filter: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IdArgs {
    /// Id da tarefa.
    pub id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SearchArgs {
    /// Termo de busca (ignora maiúsculas e acentos).
    pub query: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateTaskArgs {
    /// Id da tarefa.
    pub id: i64,
    /// Novo título.
    pub title: Option<String>,
    /// Novas notas em markdown. ATENÇÃO: SUBSTITUI todas as notas existentes. Para só acrescentar, use append_task_notes.
    pub notes: Option<String>,
    /// Nova data YYYY-MM-DD; string vazia remove a data.
    pub due_date: Option<String>,
    /// Substitui as etiquetas da tarefa.
    pub tags: Option<Vec<String>>,
    /// Prioridade: 0 nenhuma, 1 baixa, 2 média, 3 alta.
    pub priority: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AppendNotesArgs {
    /// Id da tarefa.
    pub id: i64,
    /// Markdown a acrescentar ao fim das notas (vai depois de uma linha em branco). Pode conter tokens de imagem como [Image #1], devolvidos por attach_image.
    pub markdown: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AttachImageArgs {
    /// Id da tarefa.
    pub id: i64,
    /// Caminho local de uma imagem png, jpg, gif ou webp (até 25 MB).
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddSubtaskArgs {
    /// Id da tarefa pai.
    pub parent_id: i64,
    /// Título da subtarefa.
    pub title: String,
}

/// Máximo de imagens embutidas em uma resposta `get_task`.
const MAX_INLINE_IMAGES: usize = 5;
/// Tamanho máximo de cada imagem embutida (bytes).
const MAX_INLINE_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

type Picked<'a> = (Vec<(&'a commands::AttachmentView, Vec<u8>)>, Vec<&'a commands::AttachmentView>);

/// Separa os anexos de imagem em os que cabem na resposta (com os bytes lidos) e os que não
/// cabem (acima do limite de quantidade/tamanho, ou arquivo ausente).
fn pick_images(atts: &[commands::AttachmentView]) -> Picked<'_> {
    let mut inline = Vec::new();
    let mut skipped = Vec::new();
    for a in atts.iter().filter(|a| a.mime.is_some()) {
        let fits = inline.len() < MAX_INLINE_IMAGES && a.size >= 0 && (a.size as u64) <= MAX_INLINE_IMAGE_BYTES;
        match fits.then(|| std::fs::read(&a.path).ok()).flatten() {
            Some(bytes) if bytes.len() as u64 <= MAX_INLINE_IMAGE_BYTES => inline.push((a, bytes)),
            _ => skipped.push(a),
        }
    }
    (inline, skipped)
}

/// Base64 padrão (RFC 4648), sem dependência extra.
fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (u32::from(c[0]) << 16) | (u32::from(*c.get(1).unwrap_or(&0)) << 8) | u32::from(*c.get(2).unwrap_or(&0));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn images_over_the_limit_are_only_listed_by_path() {
        let dir = std::env::temp_dir().join(format!("prumo-mcp-img-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mk = |i: i64, name: &str, bytes: &[u8]| {
            let path = dir.join(name);
            std::fs::write(&path, bytes).unwrap();
            commands::AttachmentView {
                id: i,
                filename: name.into(),
                path: path.to_string_lossy().into_owned(),
                mime: tarefas_core::image_mime(name).map(str::to_string),
                token: tarefas_core::image_number(name).map(|n| format!("[Image #{n}]")),
                size: bytes.len() as i64,
            }
        };
        let mut atts: Vec<_> = (0..7).map(|i| mk(i, &format!("{i}.png"), b"png")).collect();
        atts.push(mk(8, "nota.txt", b"txt"));
        let mut gone = mk(9, "sumiu.png", b"x");
        gone.path = dir.join("nao-existe.png").to_string_lossy().into_owned();
        atts.insert(0, gone);
        let (inline, skipped) = pick_images(&atts);
        assert_eq!(inline.len(), MAX_INLINE_IMAGES);
        // o arquivo ausente e as 2 imagens além do limite ficam de fora; o .txt nem é imagem
        assert_eq!(skipped.len(), 3);
        std::fs::remove_dir_all(&dir).ok();
    }
}

#[derive(Clone)]
pub struct PrumoServer {
    db: Arc<Mutex<Db>>,
    tool_router: ToolRouter<Self>,
}

fn json<T: serde::Serialize>(r: commands::Result<T>) -> Result<String, ErrorData> {
    match r {
        Ok(v) => serde_json::to_string_pretty(&v).map_err(|e| ErrorData::internal_error(e.to_string(), None)),
        Err(m) => Err(ErrorData::invalid_params(m, None)),
    }
}

impl PrumoServer {
    pub fn new(db: Db) -> Self {
        Self { db: Arc::new(Mutex::new(db)), tool_router: Self::tool_router() }
    }

    fn with<T>(&self, f: impl FnOnce(&Db) -> commands::Result<T>) -> commands::Result<T> {
        let db = self.db.lock().map_err(|_| "banco indisponível".to_string())?;
        f(&db)
    }
}

#[tool_router]
impl PrumoServer {
    #[tool(description = "Cria uma tarefa. Datas sempre no formato YYYY-MM-DD. As notas aceitam markdown (o app tem um editor markdown), então use as notas para o contexto detalhado: passos, checklist, trechos de código, links. Para incluir imagens, crie a tarefa e depois use attach_image e append_task_notes. A tarefa nova vai para a CAIXA DE ENTRADA (aguarda aprovação do usuário), nunca direto para Hoje.")]
    fn add_task(&self, Parameters(a): Parameters<AddTaskArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| {
            commands::add(db, SOURCE_MCP, &a.title, a.notes.as_deref(), a.due_date.as_deref(), a.tags.as_deref().unwrap_or(&[]))
        }))
    }

    #[tool(description = "Lista tarefas. filter: today (padrão) | tomorrow | all (pendentes) | done | inbox (aguardando aprovação) | overdue. Datas em YYYY-MM-DD.")]
    fn list_tasks(&self, Parameters(a): Parameters<ListTasksArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| {
            let f = Filter::parse(a.filter.as_deref().unwrap_or("today"))?;
            commands::list(db, f)
        }))
    }

    #[tool(description = "Mostra uma tarefa completa pelo id: título, notas, subtarefas e anexos. As imagens anexadas (prints colados nas notas aparecem no texto como [Image #1], [Image #2]... e cada imagem vem rotulada com o mesmo número) vêm embutidas na resposta para você enxergá-las. Imagens acima do limite (5 por chamada, 5 MB cada) vão só com o caminho do arquivo no texto; abra-o com sua ferramenta de leitura de arquivos.")]
    fn get_task(&self, Parameters(a): Parameters<IdArgs>) -> Result<CallToolResult, ErrorData> {
        let d = self.with(|db| commands::show(db, a.id)).map_err(|m| ErrorData::invalid_params(m, None))?;
        let (images, skipped) = pick_images(&d.task.attachments);
        let mut text = commands::render_detail(&d);
        if !skipped.is_empty() {
            text.push_str("\n\nImagens não embutidas (limite excedido ou arquivo ilegível); abra pelo caminho:");
            for a in &skipped {
                text.push_str(&format!("\n  {} ({})", a.filename, a.path));
            }
        }
        let mut content = vec![ContentBlock::text(text)];
        for (att, data) in images {
            let label = att.token.as_deref().map(|t| t.trim_matches(['[', ']'])).unwrap_or(&att.filename);
            content.push(ContentBlock::text(format!("{label} ({})", att.filename)));
            content.push(ContentBlock::image(base64_encode(&data), att.mime.clone().unwrap_or_default()));
        }
        Ok(CallToolResult::success(content))
    }

    #[tool(description = "Acrescenta markdown ao FIM das notas de uma tarefa (separado por uma linha em branco), sem apagar o que já está lá. Use para registrar plano, resultado, checklist ou contexto. Suporta markdown completo (títulos, listas, `- [ ]` checklists, tabelas, blocos de código, links) e tokens de imagem [Image #N] de attach_image.")]
    fn append_task_notes(&self, Parameters(a): Parameters<AppendNotesArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| commands::append_notes(db, a.id, &a.markdown)))
    }

    #[tool(description = "Anexa uma imagem local (png, jpg, gif ou webp, até 25 MB) a uma tarefa e devolve o token [Image #N]. O token só aparece nas notas se você o escrever lá: coloque-o no markdown (append_task_notes ou update_task) no ponto onde a imagem deve aparecer; o app mostra a miniatura e outros agentes a veem com get_task.")]
    fn attach_image(&self, Parameters(a): Parameters<AttachImageArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| commands::attach_image(db, a.id, std::path::Path::new(&a.path), &tarefas_core::data_dir().join("attachments"))))
    }

    #[tool(description = "Marca uma tarefa como concluída pelo id.")]
    fn complete_task(&self, Parameters(a): Parameters<IdArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| commands::complete(db, a.id)))
    }

    #[tool(description = "Busca tarefas por termo (título e notas), ignorando maiúsculas e acentos.")]
    fn search_tasks(&self, Parameters(a): Parameters<SearchArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| commands::search(db, &a.query)))
    }

    #[tool(description = "Atualiza campos de uma tarefa (só os informados). due_date em YYYY-MM-DD (string vazia remove). Atenção: notes SUBSTITUI as notas inteiras, inclusive o que o usuário escreveu; leia antes com get_task e prefira append_task_notes para acrescentar. Não move a tarefa para Hoje: a aprovação da caixa de entrada é do usuário.")]
    fn update_task(&self, Parameters(a): Parameters<UpdateTaskArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| {
            commands::update(db, a.id, a.title.as_deref(), a.notes.as_deref(), a.due_date.as_deref(), a.tags.as_deref(), a.priority)
        }))
    }

    #[tool(description = "Adiciona uma subtarefa (item de checklist) a uma tarefa. Herda o status da tarefa pai (caixa de entrada se o pai ainda não foi aprovado).")]
    fn add_subtask(&self, Parameters(a): Parameters<AddSubtaskArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| commands::add_subtask(db, a.parent_id, &a.title)))
    }

    #[tool(description = "Lista as etiquetas (tags) com a contagem de tarefas pendentes.")]
    fn list_tags(&self) -> Result<String, ErrorData> {
        json(self.with(commands::tags))
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for PrumoServer {
    fn get_info(&self) -> rmcp::model::ServerConfig {
        let mut info = rmcp::model::ServerConfig::default();
        info.server_info.name = "prumo".into();
        info.server_info.version = env!("CARGO_PKG_VERSION").into();
        info.capabilities = rmcp::model::ServerCapabilities::builder().enable_tools().build();
        info
    }
}

/// Sobe o servidor MCP em stdio e bloqueia até o cliente fechar a conexão.
pub async fn serve_stdio(db: Db) -> Result<(), Box<dyn std::error::Error>> {
    let service = PrumoServer::new(db).serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}

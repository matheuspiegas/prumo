//! Servidor MCP (stdio) sobre a camada `commands`. Não há tool de exclusão.

use std::sync::{Arc, Mutex};

use rmcp::{
    ErrorData, ServerHandler, ServiceExt,
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
    /// Notas (opcional).
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
    /// Novas notas.
    pub notes: Option<String>,
    /// Nova data YYYY-MM-DD; string vazia remove a data.
    pub due_date: Option<String>,
    /// Substitui as etiquetas da tarefa.
    pub tags: Option<Vec<String>>,
    /// Prioridade: 0 nenhuma, 1 baixa, 2 média, 3 alta.
    pub priority: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddSubtaskArgs {
    /// Id da tarefa pai.
    pub parent_id: i64,
    /// Título da subtarefa.
    pub title: String,
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
    #[tool(description = "Cria uma tarefa. Datas sempre no formato YYYY-MM-DD. A tarefa nova vai para a CAIXA DE ENTRADA (aguarda aprovação do usuário), nunca direto para Hoje.")]
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

    #[tool(description = "Marca uma tarefa como concluída pelo id.")]
    fn complete_task(&self, Parameters(a): Parameters<IdArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| commands::complete(db, a.id)))
    }

    #[tool(description = "Busca tarefas por termo (título e notas), ignorando maiúsculas e acentos.")]
    fn search_tasks(&self, Parameters(a): Parameters<SearchArgs>) -> Result<String, ErrorData> {
        json(self.with(|db| commands::search(db, &a.query)))
    }

    #[tool(description = "Atualiza campos de uma tarefa (só os informados). due_date em YYYY-MM-DD (string vazia remove). Não move a tarefa para Hoje: a aprovação da caixa de entrada é do usuário.")]
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

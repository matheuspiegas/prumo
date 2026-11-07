use std::process::ExitCode;

use clap::{Parser, Subcommand};
use prumo_cli::{commands, mcp};
use tarefas_core::{Db, data_dir};

#[derive(Parser)]
#[command(name = "prumo-cli", version, about = "Prumo na linha de comando. Tarefas criadas aqui vão para a caixa de entrada.")]
struct Cli {
    /// Saída em JSON
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Cria uma tarefa (vai para a caixa de entrada)
    Add {
        title: String,
        /// YYYY-MM-DD, hoje ou amanhã
        #[arg(long)]
        due: Option<String>,
        #[arg(long)]
        notes: Option<String>,
        #[arg(long = "tag")]
        tags: Vec<String>,
    },
    /// Lista tarefas (padrão: hoje)
    List {
        #[arg(long, group = "f")]
        today: bool,
        #[arg(long, group = "f")]
        tomorrow: bool,
        #[arg(long, group = "f")]
        all: bool,
        #[arg(long, group = "f")]
        done: bool,
        #[arg(long, group = "f")]
        inbox: bool,
        #[arg(long, group = "f")]
        overdue: bool,
    },
    /// Conclui uma tarefa
    Done { id: i64 },
    /// Busca tarefas
    Search { term: String },
    /// Lista as tags
    Tags,
    /// Servidor MCP via stdio
    Mcp,
}

fn open_db() -> Result<Db, String> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("não foi possível criar {}: {e}", dir.display()))?;
    Db::open(dir.join("prumo.db")).map_err(|e| format!("não foi possível abrir o banco: {e}"))
}

fn out<T: serde::Serialize>(json: bool, v: &T, text: impl FnOnce() -> String) {
    if json {
        println!("{}", serde_json::to_string_pretty(v).unwrap());
    } else {
        println!("{}", text());
    }
}

fn run(cli: Cli) -> Result<(), String> {
    let db = open_db()?;
    let j = cli.json;
    match cli.cmd {
        Cmd::Add { title, due, notes, tags } => {
            let t = commands::add(&db, commands::SOURCE_CLI, &title, notes.as_deref(), due.as_deref(), &tags)?;
            out(j, &t, || format!("Criada na caixa de entrada: {}", commands::render_task(&t)));
        }
        Cmd::List { tomorrow, all, done, inbox, overdue, .. } => {
            let f = if tomorrow {
                commands::Filter::Tomorrow
            } else if all {
                commands::Filter::All
            } else if done {
                commands::Filter::Done
            } else if inbox {
                commands::Filter::Inbox
            } else if overdue {
                commands::Filter::Overdue
            } else {
                commands::Filter::Today
            };
            let ts = commands::list(&db, f)?;
            out(j, &ts, || commands::render_tasks(&ts));
        }
        Cmd::Done { id } => {
            let t = commands::complete(&db, id)?;
            out(j, &t, || format!("Concluída: {}", commands::render_task(&t)));
        }
        Cmd::Search { term } => {
            let ts = commands::search(&db, &term)?;
            out(j, &ts, || commands::render_tasks(&ts));
        }
        Cmd::Tags => {
            let ts = commands::tags(&db)?;
            out(j, &ts, || commands::render_tags(&ts));
        }
        Cmd::Mcp => {
            let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
            rt.block_on(mcp::serve_stdio(db)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(m) => {
            eprintln!("erro: {m}");
            ExitCode::FAILURE
        }
    }
}

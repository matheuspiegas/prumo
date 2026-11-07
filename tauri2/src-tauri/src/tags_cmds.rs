//! Comandos Tauri de tags.
use crate::{err, lock, AppDb, TaskDto};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct TagDto {
    name: String,
    count: i64,
}

#[tauri::command]
pub fn list_tags(db: State<AppDb>) -> Result<Vec<TagDto>, String> {
    Ok(lock(&db)?
        .list_tags()
        .map_err(err)?
        .into_iter()
        .map(|t| TagDto { name: t.name, count: t.count })
        .collect())
}

#[tauri::command]
pub fn set_task_tags(db: State<AppDb>, task_id: i64, tags: Vec<String>) -> Result<(), String> {
    lock(&db)?.set_task_tags(task_id, &tags).map_err(err)
}

/// Tarefas vivas e pendentes com a tag.
#[tauri::command]
pub fn list_tasks_by_tag(db: State<AppDb>, name: String) -> Result<Vec<TaskDto>, String> {
    let db = lock(&db)?;
    let tasks = db.tasks_with_tag(&name, false).map_err(err)?;
    crate::with_tags(&db, tasks)
}

#[tauri::command]
pub fn rename_tag(db: State<AppDb>, old: String, new: String) -> Result<(), String> {
    lock(&db)?.rename_tag(&old, &new).map_err(err)
}

#[tauri::command]
pub fn delete_tag(db: State<AppDb>, name: String) -> Result<(), String> {
    lock(&db)?.delete_tag(&name).map_err(err)
}

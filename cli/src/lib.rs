//! Lógica do CLI e do servidor MCP do Prumo.
//!
//! `commands` é a camada testável (sem clap/rmcp); `mcp` expõe as mesmas
//! operações como tools MCP.

pub mod commands;
pub mod mcp;

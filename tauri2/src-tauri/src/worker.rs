//! Processo auxiliar de transcrição. O motor nativo (ggml/ONNX) pode derrubar o processo inteiro
//! (instrução ilegal, falta de memória...). Rodando-o em um processo à parte, o Prumo continua
//! vivo, mostra o erro e registra o código de saída no log.
//!
//! Uso interno: `prumo --stt-worker <modelo> <pcm_f32_le> <saida_json>`
use crate::stt;
use std::path::Path;

/// Se o programa foi chamado como worker, executa e devolve o código de saída.
pub fn maybe_run() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--stt-worker") {
        return None;
    }
    Some(run(&args[2..]))
}

/// Amostras gravadas como `f32` little-endian, sem cabeçalho.
pub fn decode_f32_le(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

fn run(args: &[String]) -> i32 {
    crate::logging::init_worker();
    let [model, pcm, out] = args else {
        crate::plog!("worker: argumentos inválidos");
        return 2;
    };
    crate::plog!("worker: iniciado");
    let result = std::fs::read(pcm)
        .map_err(|e| format!("Não consegui ler o áudio: {e}"))
        .map(|b| decode_f32_le(&b))
        .and_then(|samples| stt::transcribe(Path::new(model), &samples));
    let json = match &result {
        Ok(text) => serde_json::json!({ "ok": true, "text": text }),
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    };
    if let Err(e) = std::fs::write(out, json.to_string()) {
        crate::plog!("worker: não consegui gravar o resultado: {e}");
        return 3;
    }
    crate::plog!("worker: concluído ({})", if result.is_ok() { "ok" } else { "erro" });
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_f32_little_endian() {
        let mut b = Vec::new();
        for s in [0.5f32, -1.0, 0.25] {
            b.extend_from_slice(&s.to_le_bytes());
        }
        b.push(0xFF); // byte sobrando é ignorado
        assert_eq!(decode_f32_le(&b), vec![0.5, -1.0, 0.25]);
    }
}

//! Captura de microfone (cpal) → mono f32 a 16 kHz.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SizedSample};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

pub const TARGET_RATE: u32 = 16_000;
const MAX_SECONDS: usize = 120;

pub struct Recording {
    stop: mpsc::Sender<()>,
    handle: JoinHandle<Result<Vec<f32>, String>>,
}

impl Recording {
    /// Encerra a gravação e devolve as amostras (mono, 16 kHz).
    pub fn finish(self) -> Result<Vec<f32>, String> {
        let _ = self.stop.send(());
        self.handle.join().map_err(|_| "A gravação falhou".to_string())?
    }
}

fn collect<T: SizedSample + Send + 'static>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    buf: Arc<Mutex<Vec<f32>>>,
    limit: usize,
    conv: fn(T) -> f32,
) -> Result<cpal::Stream, String> {
    device
        .build_input_stream(
            config.clone(),
            move |data: &[T], _| {
                if let Ok(mut b) = buf.lock() {
                    if b.len() < limit {
                        b.extend(data.iter().map(|s| conv(*s)));
                    }
                }
            },
            |e| eprintln!("erro de áudio: {e}"),
            None,
        )
        .map_err(|e| format!("Não foi possível abrir o microfone: {e}"))
}

pub fn start() -> Result<Recording, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    // O `Stream` do cpal não é `Send` em algumas plataformas: vive numa thread própria.
    let handle = std::thread::spawn(move || -> Result<Vec<f32>, String> {
        let setup = || -> Result<(cpal::Stream, Arc<Mutex<Vec<f32>>>, u32, usize), String> {
            let device = cpal::default_host()
                .default_input_device()
                .ok_or("Nenhum microfone encontrado (verifique a permissão de microfone)")?;
            let cfg = device.default_input_config().map_err(|e| format!("Microfone indisponível: {e}"))?;
            let (rate, channels, fmt) = (cfg.sample_rate(), cfg.channels() as usize, cfg.sample_format());
            let stream_cfg: cpal::StreamConfig = cfg.into();
            let buf = Arc::new(Mutex::new(Vec::new()));
            let limit = rate as usize * channels * MAX_SECONDS;
            let stream = match fmt {
                SampleFormat::F32 => collect::<f32>(&device, &stream_cfg, buf.clone(), limit, |s| s)?,
                SampleFormat::I16 => collect::<i16>(&device, &stream_cfg, buf.clone(), limit, |s| s as f32 / 32768.0)?,
                SampleFormat::U16 => collect::<u16>(&device, &stream_cfg, buf.clone(), limit, |s| (s as f32 - 32768.0) / 32768.0)?,
                other => return Err(format!("Formato de áudio não suportado: {other:?}")),
            };
            stream.play().map_err(|e| format!("Não foi possível iniciar a gravação: {e}"))?;
            Ok((stream, buf, rate, channels))
        };
        match setup() {
            Err(e) => {
                let _ = ready_tx.send(Err(e.clone()));
                Err(e)
            }
            Ok((stream, buf, rate, channels)) => {
                let _ = ready_tx.send(Ok(()));
                let _ = stop_rx.recv();
                drop(stream);
                let raw = std::mem::take(&mut *buf.lock().map_err(|_| "buffer corrompido")?);
                Ok(to_mono_16k(&raw, channels, rate))
            }
        }
    });

    match ready_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(())) => Ok(Recording { stop: stop_tx, handle }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Tempo esgotado ao abrir o microfone".into()),
    }
}

/// Mistura os canais e reamostra para 16 kHz (média por janela, suficiente para fala).
pub fn to_mono_16k(raw: &[f32], channels: usize, rate: u32) -> Vec<f32> {
    let channels = channels.max(1);
    let mono: Vec<f32> = raw.chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect();
    if rate == TARGET_RATE || mono.is_empty() {
        return mono;
    }
    let ratio = rate as f64 / TARGET_RATE as f64;
    let n = (mono.len() as f64 / ratio).floor() as usize;
    (0..n)
        .map(|i| {
            let a = (i as f64 * ratio) as usize;
            let b = (((i + 1) as f64 * ratio).ceil() as usize).clamp(a + 1, mono.len());
            mono[a..b].iter().sum::<f32>() / (b - a) as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmixes_and_resamples() {
        // estéreo 48 kHz, 4800 quadros = 0,1 s → 1600 amostras a 16 kHz
        let raw: Vec<f32> = (0..9600).map(|i| if i % 2 == 0 { 1.0 } else { 0.0 }).collect();
        let out = to_mono_16k(&raw, 2, 48_000);
        assert_eq!(out.len(), 1600);
        assert!(out.iter().all(|s| (s - 0.5).abs() < 1e-6));
    }

    #[test]
    fn passthrough_at_16k() {
        assert_eq!(to_mono_16k(&[0.1, 0.2, 0.3], 1, 16_000), vec![0.1, 0.2, 0.3]);
        assert!(to_mono_16k(&[], 1, 44_100).is_empty());
    }
}

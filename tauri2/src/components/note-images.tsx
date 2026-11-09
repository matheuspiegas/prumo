import { useEffect, useState } from "react";
import { api, imageMime } from "@/lib/api";

/** Formatos de imagem que podem ser coladas nas notas (os mesmos que os agentes costumam aceitar). */
export const PASTE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** Tamanho máximo de uma imagem colada (bate com o limite do backend). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Busca os bytes de um anexo pelo id (a interface nunca escolhe caminhos) e devolve uma URL de objeto. */
export function useSavedImageUrl(id: number, name: string): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    api
      .readAttachment(id)
      .then((buf) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([buf], { type: imageMime(name) ?? "image/png" }));
        setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, name]);
  return { src, failed };
}

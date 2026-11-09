import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, imageMime } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Formatos de imagem que podem ser coladas nas notas (os mesmos que os agentes costumam aceitar). */
export const PASTE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** Tamanho máximo de uma imagem colada (bate com o limite do backend). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Marcador markdown que fica no texto da nota no ponto onde a imagem foi colada. */
export const imageMarker = (name: string) => `![${name}](anexo:${name})`;

/** Remove da nota o marcador de uma imagem (a linha inteira, ou só o trecho se estiver no meio do texto). */
export function stripImageMarker(text: string, name: string): string {
  const m = imageMarker(name);
  return text
    .split("\n")
    .filter((l) => l.trim() !== m)
    .join("\n")
    .replace(m, "");
}

/** Nome único para uma imagem colada: `imagem-AAAAMMDD-HHMMSS-N.ext`. */
export function newImageName(mime: string, taken: Set<string>): string {
  const ext = mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "png");
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let n = 1;
  let name = `imagem-${stamp}-${n}.${ext}`;
  while (taken.has(name)) name = `imagem-${stamp}-${++n}.${ext}`;
  return name;
}

type ThumbProps = { name: string; src: string | null; failed?: boolean; onRemove: () => void };

/** Miniatura que amplia ao clicar (no próprio lugar, ocupando a largura toda). */
export function ImageThumb({ name, src, failed, onRemove }: ThumbProps) {
  const [big, setBig] = useState(false);
  return (
    <div className={cn("group relative overflow-hidden rounded-md border bg-muted/30", big && "col-span-full")}>
      {src ? (
        <button
          type="button"
          className="block w-full cursor-zoom-in data-[big=true]:cursor-zoom-out"
          data-big={big}
          onClick={() => setBig((b) => !b)}
          aria-label={big ? "Reduzir imagem" : "Ampliar imagem"}
        >
          <img src={src} alt={name} className={cn("w-full", big ? "max-h-[60vh] object-contain" : "h-24 object-cover")} />
        </button>
      ) : (
        <div className={cn("flex h-24 items-center justify-center text-xs text-muted-foreground", !failed && "animate-pulse bg-muted")}>
          {failed ? "Imagem indisponível" : null}
        </div>
      )}
      <div className="truncate px-1.5 py-0.5 text-xs text-muted-foreground">{name}</div>
      <Button
        type="button"
        size="icon-xs"
        variant="secondary"
        className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
        aria-label={`Remover ${name}`}
      >
        <X />
      </Button>
    </div>
  );
}

/** Miniatura de um anexo já salvo: busca os bytes pelo id (a interface nunca escolhe caminhos). */
export function SavedImageThumb({ id, name, onRemove }: { id: number; name: string; onRemove: () => void }) {
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
  return <ImageThumb name={name} src={src} failed={failed} onRemove={onRemove} />;
}

import { useContext, useState } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useSavedImageUrl } from "@/components/note-images";
import { cn } from "@/lib/utils";
import { ImageTokenBase } from "./image-token";
import { NoteImagesContext, type NoteImage } from "./image-context";

/** Miniatura de uma imagem já salva. */
function SavedImg({ img, className }: { img: NoteImage; className: string }) {
  const { src, failed } = useSavedImageUrl(img.id!, img.name);
  if (failed) return <span className="px-2 py-1 text-xs text-muted-foreground">imagem indisponível</span>;
  if (!src) return <span className="block h-20 w-28 animate-pulse rounded bg-muted" />;
  return <img src={src} alt={img.name} className={className} draggable={false} />;
}

/** O token `[Image #N]` aparece como miniatura no texto; clicar amplia, clicar de novo reduz. */
function ImageTokenView({ node, selected }: NodeViewProps) {
  const { find } = useContext(NoteImagesContext);
  const [big, setBig] = useState(false);
  const n: number | null = node.attrs.n;
  const name: string | null = node.attrs.name;
  const img = find(n, name);
  const label = n != null ? `Image #${n}` : (name ?? "imagem");
  const imgClass = cn("rounded", big ? "max-h-[50vh] max-w-full object-contain" : "h-20 w-auto max-w-40 object-cover");

  return (
    <NodeViewWrapper as="span" className="mx-0.5 inline-block align-middle">
      <span
        contentEditable={false}
        className={cn(
          "inline-flex flex-col overflow-hidden rounded-md border bg-muted/30 align-middle",
          big && "max-w-full",
          selected && "ring-2 ring-ring",
        )}
      >
        {img ? (
          <button
            type="button"
            className={cn("block", big ? "cursor-zoom-out" : "cursor-zoom-in")}
            onClick={() => setBig((b) => !b)}
            aria-label={big ? `Reduzir ${label}` : `Ampliar ${label}`}
          >
            {img.id != null ? <SavedImg img={img} className={imgClass} /> : <img src={img.url} alt={img.name} className={imgClass} draggable={false} />}
          </button>
        ) : (
          <span className="px-2 py-1.5 text-xs text-muted-foreground">imagem não encontrada</span>
        )}
        <span className="px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">{label}</span>
      </span>
    </NodeViewWrapper>
  );
}

/** Nó de imagem com a miniatura em React. */
export const ImageToken = ImageTokenBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageTokenView);
  },
});

import { FileText, ImagePlus, Paperclip, Plus, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSavedImageUrl } from "@/components/note-images";
import type { NoteImage } from "@/components/notes-editor/image-context";
import { api, baseName, formatSize, type Attachment } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DUR_BASE, DUR_FAST, easeOut } from "@/lib/motion";

/** Item da lista: altura + fade ao entrar/sair. */
const itemMotion = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto", transition: { duration: DUR_BASE, ease: easeOut } },
  exit: { opacity: 0, height: 0, transition: { duration: DUR_FAST } },
} as const;

function SavedThumb({ img }: { img: NoteImage }) {
  const { src } = useSavedImageUrl(img.id!, img.name);
  return src ? <img src={src} alt="" className="size-8 shrink-0 rounded object-cover" /> : <span className="size-8 shrink-0 animate-pulse rounded bg-muted" />;
}

const imageLabel = (i: NoteImage) => (i.n != null ? `Image #${i.n}` : i.name);

type Props = {
  /** Arquivos já salvos que não são imagens. */
  files: Attachment[];
  /** Caminhos escolhidos numa tarefa nova (ainda não copiados). */
  pending: string[];
  /** Imagens da tarefa (as coladas nas notas aparecem como `[Image #N]`). */
  images: NoteImage[];
  dragging: boolean;
  onChoose: () => void;
  onRemoveFile: (a: Attachment) => void;
  onRemovePending: (path: string) => void;
  onInsertImage: (i: NoteImage) => void;
  onRemoveImage: (i: NoteImage) => void;
};

/** Anexos da tarefa: arquivos soltos e as imagens das notas (com opção de reinserir o token no texto). */
export function TaskAttachments({ files, pending, images, dragging, onChoose, onRemoveFile, onRemovePending, onInsertImage, onRemoveImage }: Props) {
  const total = files.length + pending.length + images.length;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Anexos{total > 0 && <span className="text-muted-foreground">({total})</span>}</Label>
      <div className={cn("flex flex-col rounded-lg border border-dashed p-3 transition-colors", dragging && "border-primary bg-accent")}>
        <AnimatePresence initial={false}>
          {total === 0 && (
            <motion.p key="vazio" {...itemMotion} className="flex items-center gap-2 overflow-hidden pb-2 text-sm text-muted-foreground">
              <Upload className="size-4" /> Arraste arquivos aqui
            </motion.p>
          )}
          {images.map((i) => (
            <motion.div key={`i${i.id ?? i.url}`} {...itemMotion} className="overflow-hidden">
              <div className="flex items-center gap-2 pb-2 text-sm">
                {i.id != null ? <SavedThumb img={i} /> : <img src={i.url} alt="" className="size-8 shrink-0 rounded object-cover" />}
                <span className="min-w-0 flex-1 truncate" title={i.name}>
                  {imageLabel(i)}
                </span>
                <Button type="button" size="xs" variant="ghost" onClick={() => onInsertImage(i)} title="Inserir na nota, no cursor">
                  <ImagePlus data-icon="inline-start" /> Inserir
                </Button>
                <Button type="button" size="icon-xs" variant="ghost" onClick={() => onRemoveImage(i)} aria-label={`Remover ${imageLabel(i)}`}>
                  <X />
                </Button>
              </div>
            </motion.div>
          ))}
          {files.map((a) => (
            <motion.div key={`s${a.id}`} {...itemMotion} className="overflow-hidden">
              <div className="flex items-center gap-2 pb-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => api.open(a.path).catch((e) => toast.error(String(e)))}
                >
                  {a.filename}
                </button>
                <span className="text-xs text-muted-foreground">{formatSize(a.size)}</span>
                <Button type="button" size="icon-xs" variant="ghost" onClick={() => onRemoveFile(a)} aria-label="Remover anexo">
                  <X />
                </Button>
              </div>
            </motion.div>
          ))}
          {pending.map((p) => (
            <motion.div key={`p${p}`} {...itemMotion} className="overflow-hidden">
              <div className="flex items-center gap-2 pb-2 text-sm">
                <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{baseName(p)}</span>
                <Button type="button" size="icon-xs" variant="ghost" onClick={() => onRemovePending(p)} aria-label="Remover anexo">
                  <X />
                </Button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={onChoose}>
          <Plus data-icon="inline-start" /> Adicionar arquivo
        </Button>
      </div>
    </div>
  );
}

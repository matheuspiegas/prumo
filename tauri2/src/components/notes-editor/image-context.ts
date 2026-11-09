import { createContext } from "react";

/** Uma imagem da tarefa, já salva (`id`) ou ainda em memória numa tarefa nova (`url`). */
export type NoteImage = {
  /** Número do token `[Image #N]`; `null` nos arquivos que não seguem o padrão `image-N.ext`. */
  n: number | null;
  name: string;
  id?: number;
  url?: string;
};

/** Deixa os nós de imagem do editor acharem o arquivo que cada token representa. */
export const NoteImagesContext = createContext<{ find: (n: number | null, name: string | null) => NoteImage | undefined }>({
  find: () => undefined,
});

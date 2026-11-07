import { AnimatePresence, motion } from "motion/react";
import { DUR_BASE, DUR_FAST, easeOut, spring } from "@/lib/motion";
import { AnimatedCount } from "@/components/animated-count";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CalendarDays, CheckCheck, Hash, Inbox, ListTodo, Settings as SettingsIcon, Trash2, Sunrise, Sun } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Counts, Filter, TagCount } from "@/lib/api";

const ITEMS: { filter: Filter; label: string; icon: typeof Sun }[] = [
  { filter: 0, label: "Hoje", icon: Sun },
  { filter: 1, label: "Amanhã", icon: Sunrise },
  { filter: 2, label: "Todas", icon: ListTodo },
  { filter: 3, label: "Concluídas", icon: CheckCheck },
];

const MItem = motion.create(SidebarMenuItem);

/** Entrada em cascata curta (custom = índice do item). */
const itemVariants = {
  hidden: { opacity: 0, x: -8 },
  show: (i: number = 0) => ({ opacity: 1, x: 0, transition: { duration: DUR_BASE, ease: easeOut, delay: Math.min(i, 10) * 0.03 } }),
};
/** Itens dinâmicos (tags): altura + fade. */
const collapseVariants = {
  hidden: { opacity: 0, height: 0 },
  show: { opacity: 1, height: "auto", transition: { duration: DUR_BASE, ease: easeOut } },
  exit: { opacity: 0, height: 0, transition: { duration: DUR_FAST } },
};

/** Botão da sidebar. O fundo do item ativo é desenhado pela <ActivePill/> (uma só, que se move). */
function NavButton({ active, onClick, children, className }: { active: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <SidebarMenuButton
      isActive={active}
      data-nav-active={active ? "true" : undefined}
      onClick={onClick}
      // Sem fundo próprio quando ativo (a pílula cuida disso) e hover mais discreto nos demais:
      // assim o item de destino não fica cinza antes de a pílula chegar.
      className={`relative data-active:bg-transparent hover:bg-sidebar-accent/50 data-active:hover:bg-transparent [&_svg]:transition-transform [&_svg]:duration-150 hover:[&_svg]:scale-110 hover:[&_svg]:-rotate-6 ${className ?? ""}`}
      render={<motion.button whileTap={{ scale: 0.97 }} transition={{ duration: 0.1 }} />}
    >
      {children}
    </SidebarMenuButton>
  );
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Uma única pílula de fundo que desliza até o botão ativo (marcado com data-nav-active).
 * Antes eram duas pílulas com layoutId e o fundo do item antigo ficava cinza durante o deslize.
 * Mede a posição do botão relativa ao contêiner; entre mudanças de item usa mola, e em
 * remedições (redimensionar, rolar, tags entrando/saindo) acompanha sem mola.
 */
function ActivePill({ wrapRef, activeKey, layoutKey }: { wrapRef: RefObject<HTMLElement | null>; activeKey: string; layoutKey: string }) {
  const [box, setBox] = useState<Box | null>(null);
  const [instant, setInstant] = useState(true);

  const measure = useCallback(
    (animate: boolean) => {
      const wrap = wrapRef.current;
      const el = wrap?.querySelector<HTMLElement>('[data-nav-active="true"]');
      if (!wrap || !el) {
        setBox(null);
        return;
      }
      const w = wrap.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const next = { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height };
      setInstant(!animate);
      setBox((prev) =>
        prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5
          ? prev
          : next,
      );
    },
    [wrapRef],
  );

  // Troca de item ativo: anima com mola.
  const first = useRef(true);
  useLayoutEffect(() => {
    measure(!first.current);
    first.current = false;
  }, [activeKey, measure]);

  // Lista de tags mudou (altura animando): remede ao longo da animação, sem mola.
  useEffect(() => {
    const ts = [0, 120, 260, 420].map((d) => setTimeout(() => measure(false), d));
    return () => ts.forEach(clearTimeout);
  }, [layoutKey, measure]);

  // Janela redimensionada ou sidebar rolada.
  useEffect(() => {
    const wrap = wrapRef.current;
    const on = () => measure(false);
    window.addEventListener("resize", on);
    wrap?.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      wrap?.removeEventListener("scroll", on, true);
    };
  }, [wrapRef, measure]);

  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 rounded-md bg-sidebar-accent"
      initial={false}
      animate={box ? { x: box.x, y: box.y, width: box.w, height: box.h, opacity: 1 } : { opacity: 0 }}
      transition={instant ? { duration: 0 } : spring}
    />
  );
}

export function AppSidebar({
  filter,
  onFilter,
  counts,
  bump,
  settingsActive,
  onSettings,
  trashActive = false,
  onTrash,
  tags = [],
  activeTag = null,
  onTag,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Counts;
  /** Pulso de chegada de uma tarefa aprovada (n muda a cada disparo). */
  bump?: { target: "today" | "tomorrow" | "all"; n: number } | null;
  settingsActive: boolean;
  onSettings: () => void;
  trashActive?: boolean;
  onTrash?: () => void;
  tags?: TagCount[];
  activeTag?: string | null;
  onTag?: (name: string) => void;
}) {
  const targetOf = (f: Filter) => (f === 0 ? "today" : f === 1 ? "tomorrow" : f === 2 ? "all" : null);
  const badge = (f: Filter) => (f === 0 ? counts.today : f === 1 ? counts.tomorrow : 0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeKey = settingsActive ? "settings" : trashActive ? "trash" : activeTag ? `tag:${activeTag.toLowerCase()}` : `f${filter}`;
  return (
    <Sidebar collapsible="none" className="border-r">
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 flex-col">
      <ActivePill wrapRef={wrapRef} activeKey={activeKey} layoutKey={tags.map((t) => t.name).join("|")} />
        <SidebarHeader className="px-4 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5" />
            <span className="text-lg font-semibold tracking-tight">Prumo</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <MItem variants={itemVariants} custom={0} initial="hidden" animate="show">
                  <NavButton active={!settingsActive && !trashActive && !activeTag && filter === 4} onClick={() => onFilter(4)}>
                    <Inbox />
                    <span>Caixa de entrada</span>
                  </NavButton>
                  {counts.inbox > 0 && (
                    <SidebarMenuBadge>
                      <AnimatedCount value={counts.inbox} />
                    </SidebarMenuBadge>
                  )}
                </MItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {ITEMS.map(({ filter: f, label, icon: Icon }, i) => (
                  <MItem key={f} data-fly-target={targetOf(f)} variants={itemVariants} custom={i + 1} initial="hidden" animate="show">
                    {bump && bump.target === targetOf(f) && (
                      <motion.span
                        key={bump.n}
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-md bg-sidebar-accent"
                        initial={{ opacity: 0.9 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: 0.6 }}
                      />
                    )}
                    <NavButton active={!settingsActive && !trashActive && !activeTag && filter === f} onClick={() => onFilter(f)}>
                      <Icon />
                      <span>{label}</span>
                    </NavButton>
                    {badge(f) > 0 && (
                      <SidebarMenuBadge>
                        <AnimatedCount value={badge(f)} pulse={bump && bump.target === targetOf(f) ? bump.n : undefined} />
                      </SidebarMenuBadge>
                    )}
                  </MItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <AnimatePresence initial={false}>
            {tags.length > 0 && (
              <motion.div key="tags" variants={collapseVariants} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
                <SidebarGroup>
                  <SidebarGroupLabel>Tags</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <AnimatePresence initial={false}>
                        {tags.map((t) => (
                          <MItem key={t.name.toLowerCase()} variants={collapseVariants} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
                            <NavButton
                              active={!settingsActive && activeTag?.toLowerCase() === t.name.toLowerCase()}
                              onClick={() => onTag?.(t.name)}
                            >
                              <Hash />
                              <span className="truncate">{t.name}</span>
                            </NavButton>
                            {t.count > 0 && (
                              <SidebarMenuBadge>
                                <AnimatedCount value={t.count} />
                              </SidebarMenuBadge>
                            )}
                          </MItem>
                        ))}
                      </AnimatePresence>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </motion.div>
            )}
          </AnimatePresence>
        </SidebarContent>
        <SidebarFooter className="p-2">
          <SidebarMenu>
            {onTrash && (
              <SidebarMenuItem>
                <NavButton active={trashActive} onClick={onTrash}>
                  <Trash2 />
                  <span>Lixeira</span>
                </NavButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <NavButton active={settingsActive} onClick={onSettings}>
                <SettingsIcon />
                <span>Configurações</span>
              </NavButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex justify-end px-1">
            <ThemeToggle />
          </div>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}

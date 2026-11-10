import { AnimatePresence, motion } from "motion/react";
import { DUR_BASE, DUR_FAST, easeOut, spring } from "@/lib/motion";
import { AnimatedCount } from "@/components/animated-count";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import { CalendarDays, CalendarRange, CheckCheck, Hash, Inbox, ListTodo, Monitor, Moon, PanelLeftClose, PenTool, PanelLeftOpen, Settings as SettingsIcon, Trash2, Sunrise, Sun } from "lucide-react";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { centerOf, useThemeTransition } from "@/hooks/use-theme-transition";
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
function NavButton({
  active,
  onClick,
  children,
  className,
  collapsed = false,
  tooltip,
}: {
  active: boolean;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  children: ReactNode;
  className?: string;
  /** Recolhida: só o ícone (o rótulo some e o tooltip mostra o nome). */
  collapsed?: boolean;
  tooltip?: string;
}) {
  return (
    <SidebarMenuButton
      isActive={active}
      data-nav-active={active ? "true" : undefined}
      onClick={onClick}
      tooltip={tooltip}
      // Sem fundo próprio quando ativo (a pílula cuida disso) e hover mais discreto nos demais:
      // assim o item de destino não fica cinza antes de a pílula chegar.
      className={`relative ${collapsed ? "justify-center [&>span]:hidden" : ""} data-active:bg-transparent hover:bg-sidebar-accent/50 data-active:hover:bg-transparent [&_svg]:transition-transform [&_svg]:duration-150 hover:[&_svg]:scale-110 hover:[&_svg]:-rotate-6 ${className ?? ""}`}
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

const THEME_ORDER = ["system", "light", "dark"] as const;
const THEME_LABEL = { system: "Tema: sistema", light: "Tema: claro", dark: "Tema: escuro" };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };

/** Linha do rodapé que alterna o tema (sistema, claro, escuro), com a revelação circular. */
function ThemeItem({ collapsed }: { collapsed: boolean }) {
  const { theme, change } = useThemeTransition();
  const current = (THEME_ORDER as readonly string[]).includes(theme) ? (theme as (typeof THEME_ORDER)[number]) : "system";
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  const Icon = THEME_ICON[current];
  return (
    <SidebarMenuItem>
      <NavButton active={false} collapsed={collapsed} tooltip={THEME_LABEL[current]} onClick={(e) => change(next, centerOf(e.currentTarget))}>
        <Icon />
        <span>{THEME_LABEL[current]}</span>
      </NavButton>
    </SidebarMenuItem>
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
  weekActive = false,
  onWeek,
  boardsActive = false,
  onBoards,
  tags = [],
  activeTag = null,
  onTag,
}: {
  weekActive?: boolean;
  onWeek?: () => void;
  boardsActive?: boolean;
  onBoards?: () => void;
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
  const { state, setOpen } = useSidebar();
  const collapsed = state === "collapsed";
  /** Expandida: contador; recolhida: só um pontinho (o número vai no tooltip). */
  const badgeOf = (n: number, node: ReactNode) =>
    n <= 0 ? null : collapsed ? (
      <span aria-hidden className="pointer-events-none absolute top-1 right-1.5 size-2 rounded-full bg-primary" />
    ) : (
      <SidebarMenuBadge>{node}</SidebarMenuBadge>
    );
  const withCount = (label: string, n: number) => (n > 0 ? `${label} · ${n}` : label);
  const activeKey = settingsActive ? "settings" : trashActive ? "trash" : boardsActive ? "boards" : weekActive ? "week" : activeTag ? `tag:${activeTag.toLowerCase()}` : `f${filter}`;
  return (
    <Sidebar
      collapsible="none"
      className="border-r transition-[width] duration-200 ease-out"
      style={{ "--sidebar-width": collapsed ? "3.5rem" : "16rem" } as CSSProperties}
    >
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 flex-col">
      <ActivePill wrapRef={wrapRef} activeKey={activeKey} layoutKey={`${collapsed ? "c" : "e"}:${tags.map((t) => t.name).join("|")}`} />
        <SidebarHeader className={collapsed ? "items-center gap-2 px-2 pt-4 pb-2" : "px-4 pt-5 pb-2"}>
          <div className={collapsed ? "flex flex-col items-center gap-2" : "flex items-center justify-between gap-2"}>
            <div className="flex items-center gap-2">
              <CalendarDays className="size-5 shrink-0" />
              {!collapsed && <span className="text-lg font-semibold tracking-tight">Prumo</span>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
              title={`${collapsed ? "Expandir" : "Recolher"} menu (Ctrl+B)`}
              onClick={() => setOpen(collapsed)}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <MItem variants={itemVariants} custom={0} initial="hidden" animate="show">
                  <NavButton collapsed={collapsed} tooltip={withCount("Caixa de entrada", counts.inbox)} active={!settingsActive && !trashActive && !weekActive && !boardsActive && !activeTag && filter === 4} onClick={() => onFilter(4)}>
                    <Inbox />
                    <span>Caixa de entrada</span>
                  </NavButton>
                  {badgeOf(counts.inbox, <AnimatedCount value={counts.inbox} />)}
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
                    <NavButton collapsed={collapsed} tooltip={withCount(label, badge(f))} active={!settingsActive && !trashActive && !weekActive && !boardsActive && !activeTag && filter === f} onClick={() => onFilter(f)}>
                      <Icon />
                      <span>{label}</span>
                    </NavButton>
                    {badgeOf(badge(f), <AnimatedCount value={badge(f)} pulse={bump && bump.target === targetOf(f) ? bump.n : undefined} />)}
                  </MItem>
                ))}
                {onWeek && (
                  <MItem variants={itemVariants} custom={ITEMS.length + 1} initial="hidden" animate="show">
                    <NavButton collapsed={collapsed} tooltip="Semana" active={weekActive && !settingsActive && !trashActive} onClick={onWeek}>
                      <CalendarRange />
                      <span>Semana</span>
                    </NavButton>
                  </MItem>
                )}
                {onBoards && (
                  <MItem variants={itemVariants} custom={ITEMS.length + 2} initial="hidden" animate="show">
                    <NavButton collapsed={collapsed} tooltip="Quadros" active={boardsActive && !settingsActive && !trashActive} onClick={onBoards}>
                      <PenTool />
                      <span>Quadros</span>
                    </NavButton>
                  </MItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <AnimatePresence initial={false}>
            {tags.length > 0 && !collapsed && (
              <motion.div key="tags" variants={collapseVariants} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
                <SidebarGroup>
                  <SidebarGroupLabel>Tags</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <AnimatePresence initial={false}>
                        {tags.map((t) => (
                          <MItem key={t.name.toLowerCase()} variants={collapseVariants} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
                            <NavButton
                              active={!settingsActive && !weekActive && activeTag?.toLowerCase() === t.name.toLowerCase()}
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
                <NavButton collapsed={collapsed} tooltip="Lixeira" active={trashActive} onClick={onTrash}>
                  <Trash2 />
                  <span>Lixeira</span>
                </NavButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <NavButton collapsed={collapsed} tooltip="Configurações" active={settingsActive} onClick={onSettings}>
                <SettingsIcon />
                <span>Configurações</span>
              </NavButton>
            </SidebarMenuItem>
            <ThemeItem collapsed={collapsed} />
          </SidebarMenu>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}

import { motion } from "motion/react";
import { bouncy } from "@/lib/motion";
import { CalendarDays, CheckCheck, Inbox, ListTodo, Settings as SettingsIcon, Trash2, Sunrise, Sun } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Counts, Filter } from "@/lib/api";

const ITEMS: { filter: Filter; label: string; icon: typeof Sun }[] = [
  { filter: 0, label: "Hoje", icon: Sun },
  { filter: 1, label: "Amanhã", icon: Sunrise },
  { filter: 2, label: "Todas", icon: ListTodo },
  { filter: 3, label: "Concluídas", icon: CheckCheck },
];

export function AppSidebar({
  filter,
  onFilter,
  counts,
  bump,
  settingsActive,
  onSettings,
  trashActive = false,
  onTrash,
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
}) {
  const targetOf = (f: Filter) => (f === 0 ? "today" : f === 1 ? "tomorrow" : f === 2 ? "all" : null);
  const badge = (f: Filter) => (f === 0 ? counts.today : f === 1 ? counts.tomorrow : 0);
  return (
    <Sidebar collapsible="none" className="border-r">
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
              <SidebarMenuItem>
                <SidebarMenuButton isActive={!settingsActive && !trashActive && filter === 4} onClick={() => onFilter(4)}>
                  <Inbox />
                  <span>Caixa de entrada</span>
                </SidebarMenuButton>
                {counts.inbox > 0 && <SidebarMenuBadge>{counts.inbox}</SidebarMenuBadge>}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {ITEMS.map(({ filter: f, label, icon: Icon }) => (
                <SidebarMenuItem key={f} data-fly-target={targetOf(f)}>
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
                  <SidebarMenuButton isActive={!settingsActive && !trashActive && filter === f} onClick={() => onFilter(f)}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                  {badge(f) > 0 && (
                    <SidebarMenuBadge>
                      <motion.span
                        key={bump && bump.target === targetOf(f) ? bump.n : "idle"}
                        className="inline-block"
                        animate={bump && bump.target === targetOf(f) ? { scale: [1, 1.5, 1] } : undefined}
                        transition={bouncy}
                      >
                        {badge(f)}
                      </motion.span>
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <SidebarMenu>
          {onTrash && (
            <SidebarMenuItem>
              <SidebarMenuButton isActive={trashActive} onClick={onTrash}>
                <Trash2 />
                <span>Lixeira</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton isActive={settingsActive} onClick={onSettings}>
              <SettingsIcon />
              <span>Configurações</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex justify-end px-1">
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

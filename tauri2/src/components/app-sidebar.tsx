import { CalendarDays, CheckCheck, Inbox, ListTodo, Settings as SettingsIcon, Sunrise, Sun } from "lucide-react";
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
  settingsActive,
  onSettings,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Counts;
  settingsActive: boolean;
  onSettings: () => void;
}) {
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
                <SidebarMenuButton isActive={!settingsActive && filter === 4} onClick={() => onFilter(4)}>
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
                <SidebarMenuItem key={f}>
                  <SidebarMenuButton isActive={!settingsActive && filter === f} onClick={() => onFilter(f)}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                  {badge(f) > 0 && <SidebarMenuBadge>{badge(f)}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <SidebarMenu>
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

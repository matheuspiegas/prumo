import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ORDER = ["system", "light", "dark"] as const;
const LABEL = { system: "Tema: sistema", light: "Tema: claro", dark: "Tema: escuro" };
const ICON = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme();
  const current = (ORDER as readonly string[]).includes(theme) ? (theme as (typeof ORDER)[number]) : "system";
  const Icon = ICON[current];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={LABEL[current]} />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{LABEL[current]}</TooltipContent>
    </Tooltip>
  );
}

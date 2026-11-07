import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR as dfPtBR } from "date-fns/locale";
import { ptBR } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fromIso, toIso } from "@/lib/api";

export function DatePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const date = value ? fromIso(value) : undefined;
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" className="justify-start font-normal">
              <CalendarIcon data-icon="inline-start" />
              {date ? format(date, "d 'de' MMMM", { locale: dfPtBR }) : "Sem data"}
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={date}
            onSelect={(d) => onChange(d ? toIso(d) : null)}
            defaultMonth={date}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="Remover data">
          <X />
        </Button>
      )}
    </div>
  );
}

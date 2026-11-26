import { BookOpen, Bug, Code, Image, Pencil, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";

export function SkillIcon({ name, size = "md", className }: { name: string; size?: "sm" | "md"; className?: string }) {
  const lower = name.toLocaleLowerCase();
  const appearance = /image|photo|design/.test(lower) ? { Icon: Image, color: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/80 dark:text-cyan-300" }
    : /review|debug|test/.test(lower) ? { Icon: Bug, color: "bg-muted text-muted-foreground" }
    : /creat|writ|edit/.test(lower) ? { Icon: Pencil, color: "bg-amber-50 text-amber-600 dark:bg-amber-950/80 dark:text-amber-300" }
    : /install|plugin/.test(lower) ? { Icon: Puzzle, color: "bg-rose-50 text-rose-500 dark:bg-rose-950/80 dark:text-rose-300" }
    : /code|develop|build/.test(lower) ? { Icon: Code, color: "bg-violet-50 text-violet-500 dark:bg-violet-950/80 dark:text-violet-300" }
    : { Icon: BookOpen, color: "bg-orange-50 text-orange-500 dark:bg-orange-950/80 dark:text-orange-300" };
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl",
        size === "sm" ? "size-9" : "size-10",
        appearance.color,
        className,
      )}
      aria-hidden="true"
    >
      <appearance.Icon className={size === "sm" ? "size-5" : "size-6"} strokeWidth={1.75} />
    </span>
  );
}

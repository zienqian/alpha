import { BookOpen, Bug, Code, Image, Pencil, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";

export function SkillIcon({ name, size = "md", className }: { name: string; size?: "sm" | "md"; className?: string }) {
  const lower = name.toLocaleLowerCase();
  const Icon = /image|photo|design/.test(lower) ? Image
    : /review|debug|test/.test(lower) ? Bug
    : /creat|writ|edit/.test(lower) ? Pencil
    : /install|plugin/.test(lower) ? Puzzle
    : /code|develop|build/.test(lower) ? Code
    : BookOpen;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80 ring-1 ring-foreground/6 dark:ring-foreground/10",
        size === "sm" ? "size-9" : "size-10",
        className,
      )}
      aria-hidden="true"
    >
      <Icon className={size === "sm" ? "size-4.5" : "size-5"} strokeWidth={1.75} />
    </span>
  );
}

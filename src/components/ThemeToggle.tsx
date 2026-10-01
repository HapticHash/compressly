import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

const LABELS = { system: "System theme", light: "Light theme", dark: "Dark theme" };

export function ThemeToggle() {
  const { preference, cycle } = useTheme();
  const Icon = preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
  return (
    <button
      onClick={cycle}
      className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20 p-2.5 rounded-full border border-border bg-surface/70 text-text-muted hover:text-primary transition-colors"
      title={`${LABELS[preference]} (click to change)`}
      aria-label={`${LABELS[preference]}. Click to change theme`}
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}

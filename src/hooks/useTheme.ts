import { useCallback, useEffect, useState } from "react";
import { readStorage, writeStorage } from "../lib/storage";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "compressly:theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Applies the theme to <html>; index.html runs the same logic before first paint. */
function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && media().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#1a1e10" : "#fefae0");
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(
    () => readStorage<ThemePreference>(STORAGE_KEY) ?? "system",
  );

  useEffect(() => {
    applyTheme(preference);
    if (preference !== "system") return;
    const query = media();
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((current) => {
      const next: ThemePreference =
        current === "system" ? "light" : current === "light" ? "dark" : "system";
      writeStorage(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { preference, cycle };
}

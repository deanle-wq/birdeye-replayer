"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

// Module memory, like the API key: it survives switching between features
// with client-side navigation and resets on a full reload.
let current: Theme = "light";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One appearance for every feature, mirrored onto <html> for the CSS tokens. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current, () => "light" as Theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const setTheme = useCallback((next: Theme | ((value: Theme) => Theme)) => {
    current = typeof next === "function" ? next(current) : next;
    listeners.forEach((listener) => listener());
  }, []);
  return [theme, setTheme] as const;
}

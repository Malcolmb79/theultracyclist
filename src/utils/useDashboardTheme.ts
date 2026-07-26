import { useEffect } from "react";
import { useTheme } from "../context/ThemeContext";

// Applies the resolved theme to <html> only while a dashboard page is
// mounted, and removes it again on unmount/navigation - so the light/dark
// toggle is scoped to the private dashboard (Dashboard/Trends/Coaching/
// Settings) without touching the public marketing site, which has no
// wrapping shell to attach this to otherwise (each dashboard page is its
// own top-level route - see routes.tsx).
export function useDashboardTheme(): void {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [resolvedTheme]);
}

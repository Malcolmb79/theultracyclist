import { useEffect } from "react";
import { useTheme } from "../context/ThemeContext";

// Applies the resolved theme to <html> while the calling page/layout is
// mounted, and removes it again on unmount/navigation. Originally scoped to
// just the private dashboard (Dashboard/Trends/Coaching/Settings, each its
// own top-level route with no shared shell to hang this off), then reused
// by the standalone public /live page, and now also called from the public
// marketing site's own Layout.tsx - so the whole site (not just /dashboard)
// shares one theme mechanism and one stored preference (same localStorage
// key, since it's all one origin).
export function useDashboardTheme(): void {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [resolvedTheme]);
}

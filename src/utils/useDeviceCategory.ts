import { useEffect, useState } from "react";

export type DeviceCategory = "mobile" | "tablet" | "desktop";

// Separate from useIsMobile (which stays scoped to widget size/cap defaults
// at the same 640px cutoff) - this is only used to pick which saved layout
// to load/save (see api/_lib/deviceLayout.ts), so phone/tablet/PC can each
// keep their own widget positions without one overwriting another.
const MOBILE_QUERY = "(max-width: 640px)";
const TABLET_QUERY = "(min-width: 641px) and (max-width: 1024px)";

function resolve(): DeviceCategory {
  if (window.matchMedia(MOBILE_QUERY).matches) return "mobile";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

export function useDeviceCategory(): DeviceCategory {
  const [device, setDevice] = useState<DeviceCategory>(resolve);

  useEffect(() => {
    const mobileMql = window.matchMedia(MOBILE_QUERY);
    const tabletMql = window.matchMedia(TABLET_QUERY);
    const handler = () => setDevice(resolve());
    mobileMql.addEventListener("change", handler);
    tabletMql.addEventListener("change", handler);
    return () => {
      mobileMql.removeEventListener("change", handler);
      tabletMql.removeEventListener("change", handler);
    };
  }, []);

  return device;
}

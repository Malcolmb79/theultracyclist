// Shared by dashboard-layout.ts, trends-layout.ts, and coaching-settings.ts
// so each device category (phone/tablet/PC) can have its own widget
// positions/sizes without one overwriting another - moving widgets around
// on mobile shouldn't touch the desktop layout, and vice versa.
export type DeviceCategory = "mobile" | "tablet" | "desktop";

export function isDeviceCategory(value: unknown): value is DeviceCategory {
  return value === "mobile" || value === "tablet" || value === "desktop";
}

// Resolves what to show for `device` given whatever's actually stored -
// either the old flat-array shape (pre-dates per-device layouts, same list
// shown on every device) or the new per-device object. A device that
// hasn't been customized yet falls back through desktop -> tablet -> mobile
// rather than starting from an empty canvas, so a first visit on a new
// device inherits whatever was already tuned instead of losing everything.
export function resolveDeviceLayout<T>(stored: unknown, device: DeviceCategory): T[] {
  if (Array.isArray(stored)) return stored as T[];
  if (stored && typeof stored === "object") {
    const byDevice = stored as Partial<Record<DeviceCategory, T[]>>;
    return byDevice[device] ?? byDevice.desktop ?? byDevice.tablet ?? byDevice.mobile ?? [];
  }
  return [];
}

// Merges a save for one device into whatever's already stored, leaving the
// other devices' layouts untouched. A legacy flat array becomes the
// desktop entry on the first per-device save, so devices that haven't
// saved yet still have something sensible to fall back to.
export function mergeDeviceLayout<T>(stored: unknown, device: DeviceCategory, next: T[]): Partial<Record<DeviceCategory, T[]>> {
  if (Array.isArray(stored)) {
    return { desktop: stored as T[], [device]: next };
  }
  const existing = stored && typeof stored === "object" ? (stored as Partial<Record<DeviceCategory, T[]>>) : {};
  return { ...existing, [device]: next };
}

/*
 * The two above assume the per-device value is an array, which is true for
 * dashboard/trends/coaching (a list of widgets). The live tracker's layout
 * is a single object instead ({ order, rects }), so "is this the legacy
 * single value or a per-device record?" can't be answered with
 * Array.isArray - both shapes are plain objects. The caller passes an
 * `isSingle` predicate to tell them apart; everything else works the same
 * way, including the desktop -> tablet -> mobile inheritance so a first
 * visit on a new device starts from whatever's already been arranged
 * rather than from nothing.
 */
export function resolveDeviceValue<T>(
  stored: unknown,
  device: DeviceCategory,
  isSingle: (value: unknown) => boolean,
): T | null {
  if (!stored || typeof stored !== "object") return null;
  if (isSingle(stored)) return stored as T;
  const byDevice = stored as Partial<Record<DeviceCategory, T>>;
  return byDevice[device] ?? byDevice.desktop ?? byDevice.tablet ?? byDevice.mobile ?? null;
}

export function mergeDeviceValue<T>(
  stored: unknown,
  device: DeviceCategory,
  next: T,
  isSingle: (value: unknown) => boolean,
): Partial<Record<DeviceCategory, T>> {
  if (stored && typeof stored === "object" && isSingle(stored)) {
    return { desktop: stored as T, [device]: next };
  }
  const existing = stored && typeof stored === "object" ? (stored as Partial<Record<DeviceCategory, T>>) : {};
  return { ...existing, [device]: next };
}

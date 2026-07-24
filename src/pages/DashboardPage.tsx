import { useEffect, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import DataCatalog from "../components/dashboard/DataCatalog";
import DashboardWidget from "../components/dashboard/DashboardWidget";
import { useDashboardData } from "../components/dashboard/useDashboardData";
import {
  CATALOG_DRAG_PREFIX,
  WHOOP_STRAIN_RECOVERY_COMBO_ID,
  DEFAULT_WIDGET_WIDTH,
  DEFAULT_WIDGET_HEIGHT,
  type Widget,
} from "../components/dashboard/types";
import type { MetricDef } from "../components/dashboard/useDashboardData";
import styles from "./DashboardPage.module.css";

const STORAGE_KEY = "dashboard-password";

function useUnlock() {
  const [password, setPassword] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    setChecking(true);
    setError(false);
    try {
      const res = await fetch("/api/dashboard-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input }),
      });
      if (res.ok) {
        localStorage.setItem(STORAGE_KEY, input);
        setPassword(input);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setChecking(false);
    }
  };

  return { password, input, setInput, error, checking, submit };
}

function nextId(): string {
  return `w_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

function defaultViewType(metric: MetricDef): Widget["viewType"] {
  if (metric.id === WHOOP_STRAIN_RECOVERY_COMBO_ID) return "combo";
  return metric.statOnly ? "stat" : "chart";
}

export default function DashboardPage() {
  const { password, input, setInput, error, checking, submit } = useUnlock();

  if (!password) {
    return (
      <div className={styles.gate}>
        <div className={styles.gateBox}>
          <h1 className={styles.gateTitle}>Dashboard</h1>
          <input
            type="password"
            className={styles.gateInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Password"
            autoFocus
          />
          <button type="button" className={styles.gateButton} onClick={submit} disabled={checking}>
            {checking ? "Checking…" : "Unlock"}
          </button>
          {error && <p className={styles.gateError}>Incorrect password.</p>}
        </div>
      </div>
    );
  }

  return <DashboardEditor password={password} />;
}

function DashboardEditor({ password }: { password: string }) {
  const data = useDashboardData();
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard-layout")
      .then((res) => res.json())
      .then((body: { widgets: Widget[] }) => {
        if (!cancelled) setWidgets(body.widgets ?? []);
      })
      .catch(() => {
        if (!cancelled) setWidgets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveWidgets = (next: Widget[]) => {
    setWidgets(next);
    fetch("/api/dashboard-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` },
      body: JSON.stringify({ widgets: next }),
    }).catch(() => {
      // best-effort; layout stays correct locally even if the save fails
    });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  if (data.status === "loading" || widgets === null) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading dashboard…</p>
      </div>
    );
  }

  const metricById = new Map(data.metrics.map((m) => [m.id, m]));
  const addedIds = new Set(widgets.map((w) => w.metric));

  const handleAdd = (metric: MetricDef) => {
    const widget: Widget = {
      id: nextId(),
      source: metric.source,
      metric: metric.id,
      label: metric.label,
      viewType: defaultViewType(metric),
      width: DEFAULT_WIDGET_WIDTH,
      height: DEFAULT_WIDGET_HEIGHT,
    };
    saveWidgets([...widgets, widget]);
    setCatalogOpen(false);
  };

  const handleRemove = (id: string) => saveWidgets(widgets.filter((w) => w.id !== id));

  const handleViewTypeChange = (id: string, viewType: Widget["viewType"]) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, viewType } : w)));

  const handleColorChange = (id: string, color: string) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, color } : w)));

  const handleResize = (id: string, width: number, height: number) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, width, height } : w)));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);

    if (activeId.startsWith(CATALOG_DRAG_PREFIX)) {
      const metricId = activeId.slice(CATALOG_DRAG_PREFIX.length);
      const metric = metricById.get(metricId);
      if (!metric || addedIds.has(metric.id)) return;

      const newWidget: Widget = {
        id: nextId(),
        source: metric.source,
        metric: metric.id,
        label: metric.label,
        viewType: defaultViewType(metric),
        width: DEFAULT_WIDGET_WIDTH,
        height: DEFAULT_WIDGET_HEIGHT,
      };

      const overIndex = widgets.findIndex((w) => w.id === over.id);
      const next = overIndex >= 0
        ? [...widgets.slice(0, overIndex), newWidget, ...widgets.slice(overIndex)]
        : [...widgets, newWidget];
      saveWidgets(next);
      setCatalogOpen(false);
      return;
    }

    if (active.id !== over.id) {
      const oldIndex = widgets.findIndex((w) => w.id === active.id);
      const newIndex = widgets.findIndex((w) => w.id === over.id);
      if (oldIndex >= 0 && newIndex >= 0) {
        saveWidgets(arrayMove(widgets, oldIndex, newIndex));
      }
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className={styles.page}>
        <button
          type="button"
          className={styles.catalogToggle}
          onClick={() => setCatalogOpen((open) => !open)}
          aria-label={catalogOpen ? "Close data menu" : "Open data menu"}
          aria-expanded={catalogOpen}
        >
          {catalogOpen ? "×" : "☰"}
        </button>

        {catalogOpen && (
          <div className={styles.catalogBackdrop} onClick={() => setCatalogOpen(false)} />
        )}

        <aside className={`${styles.catalogDrawer} ${catalogOpen ? styles.catalogDrawerOpen : ""}`}>
          <DataCatalog metrics={data.metrics} addedIds={addedIds} onAdd={handleAdd} />
        </aside>

        <Canvas>
          {widgets.length === 0 ? (
            <p className={styles.emptyCanvas}>Open the menu to add data and build your dashboard.</p>
          ) : (
            <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
              <div className={styles.widgetGrid}>
                {widgets.map((widget) => (
                  <DashboardWidget
                    key={widget.id}
                    widget={widget}
                    metricById={metricById}
                    onViewTypeChange={(viewType) => handleViewTypeChange(widget.id, viewType)}
                    onColorChange={(color) => handleColorChange(widget.id, color)}
                    onResize={(width, height) => handleResize(widget.id, width, height)}
                    onRemove={() => handleRemove(widget.id)}
                  />
                ))}
              </div>
            </SortableContext>
          )}
        </Canvas>
      </div>
    </DndContext>
  );
}

function Canvas({ children }: { children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: "canvas" });
  return (
    <main ref={setNodeRef} className={styles.canvas}>
      {children}
    </main>
  );
}

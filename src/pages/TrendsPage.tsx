import { useEffect, useRef, useState } from "react";
import TrendsCatalog from "../components/trends/TrendsCatalog";
import TrendsWidget from "../components/trends/TrendsWidget";
import { useTrendsData, type TrendMetricDef } from "../components/trends/useTrendsData";
import type { TrendsWidgetConfig, TrendsViewType } from "../components/trends/types";
import styles from "./TrendsPage.module.css";

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
  return `t_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

export default function TrendsPage() {
  const { password, input, setInput, error, checking, submit } = useUnlock();

  if (!password) {
    return (
      <div className={styles.gate}>
        <div className={styles.gateBox}>
          <h1 className={styles.gateTitle}>Trends</h1>
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

  return <TrendsEditor password={password} />;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function TrendsEditor({ password }: { password: string }) {
  const data = useTrendsData(password);
  const [widgets, setWidgets] = useState<TrendsWidgetConfig[] | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const lastAttempt = useRef<TrendsWidgetConfig[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/trends-layout")
      .then((res) => res.json())
      .then((body: { widgets: TrendsWidgetConfig[] }) => {
        if (!cancelled) setWidgets(body.widgets ?? []);
      })
      .catch(() => {
        if (!cancelled) setWidgets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = (next: TrendsWidgetConfig[]) => {
    lastAttempt.current = next;
    setSaveStatus("saving");
    fetch("/api/trends-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` },
      body: JSON.stringify({ widgets: next }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        setSaveStatus("saved");
      })
      .catch(() => setSaveStatus("error"));
  };

  const saveWidgets = (next: TrendsWidgetConfig[]) => {
    setWidgets(next);
    persist(next);
  };

  const retrySave = () => {
    if (lastAttempt.current) persist(lastAttempt.current);
  };

  if (data.status === "loading" || widgets === null) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading trends…</p>
      </div>
    );
  }

  const metricById = new Map(data.metrics.map((m) => [m.id, m]));

  const handleAdd = (metric: TrendMetricDef) => {
    const widget: TrendsWidgetConfig = {
      id: nextId(),
      metric: metric.id,
      label: metric.label,
      viewType: "day",
    };
    saveWidgets([...widgets, widget]);
    setCatalogOpen(false);
  };

  const handleRemove = (id: string) => saveWidgets(widgets.filter((w) => w.id !== id));

  const handleViewTypeChange = (id: string, viewType: TrendsViewType) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, viewType } : w)));

  const handleColorChange = (id: string, color: string) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, color } : w)));

  const handleResize = (id: string, width: number, height: number) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, width, height } : w)));

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button
          type="button"
          className={styles.catalogToggle}
          onClick={() => setCatalogOpen((open) => !open)}
          aria-label={catalogOpen ? "Close data menu" : "Open data menu"}
          aria-expanded={catalogOpen}
        >
          {catalogOpen ? "×" : "☰"}
        </button>
        {saveStatus === "error" ? (
          <button type="button" className={`${styles.saveStatus} ${styles.saveStatusError}`} onClick={retrySave}>
            Save failed — tap to retry
          </button>
        ) : (
          saveStatus !== "idle" && (
            <span className={`${styles.saveStatus} ${saveStatus === "saved" ? styles.saveStatusSaved : ""}`}>
              {saveStatus === "saving" ? "Saving…" : "Saved"}
            </span>
          )
        )}
        <a href="/dashboard" className={styles.switchLink}>
          Main dashboard
        </a>
        <a href="/dashboard/coaching" className={styles.switchLink}>
          Coaching
        </a>
      </div>

      {catalogOpen && <div className={styles.catalogBackdrop} onClick={() => setCatalogOpen(false)} />}

      <aside className={`${styles.catalogDrawer} ${catalogOpen ? styles.catalogDrawerOpen : ""}`}>
        <TrendsCatalog metrics={data.metrics} goals={data.goals} onSaveGoals={data.saveGoals} onAdd={handleAdd} />
      </aside>

      <main className={styles.canvas}>
        {widgets.length === 0 ? (
          <p className={styles.emptyCanvas}>Open the menu to add data and build your trends dashboard.</p>
        ) : (
          <div className={`${styles.widgetGrid} ${isResizing ? styles.widgetGridSnap : ""}`}>
            {widgets.map((widget) => (
              <TrendsWidget
                key={widget.id}
                widget={widget}
                metric={metricById.get(widget.metric)}
                days={data.days}
                onViewTypeChange={(viewType) => handleViewTypeChange(widget.id, viewType)}
                onColorChange={(color) => handleColorChange(widget.id, color)}
                onResize={(width, height) => handleResize(widget.id, width, height)}
                onResizingChange={setIsResizing}
                onRemove={() => handleRemove(widget.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

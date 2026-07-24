import { useEffect, useState } from "react";
import DataCatalog from "../components/dashboard/DataCatalog";
import DashboardWidget from "../components/dashboard/DashboardWidget";
import { useDashboardData } from "../components/dashboard/useDashboardData";
import type { Widget } from "../components/dashboard/types";
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
      viewType: metric.statOnly ? "stat" : "chart",
    };
    saveWidgets([...widgets, widget]);
  };

  const handleRemove = (id: string) => saveWidgets(widgets.filter((w) => w.id !== id));

  const handleViewTypeChange = (id: string, viewType: Widget["viewType"]) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, viewType } : w)));

  const handleMove = (index: number, direction: -1 | 1) => {
    const next = widgets.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    saveWidgets(next);
  };

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <DataCatalog metrics={data.metrics} addedIds={addedIds} onAdd={handleAdd} />
        </aside>
        <main className={styles.canvas}>
          {widgets.length === 0 ? (
            <p className={styles.emptyCanvas}>Add data from the panel to build your dashboard.</p>
          ) : (
            <div className={styles.widgetGrid}>
              {widgets.map((widget, index) => (
                <DashboardWidget
                  key={widget.id}
                  widget={widget}
                  metric={metricById.get(widget.metric)}
                  onViewTypeChange={(viewType) => handleViewTypeChange(widget.id, viewType)}
                  onMoveUp={() => handleMove(index, -1)}
                  onMoveDown={() => handleMove(index, 1)}
                  onRemove={() => handleRemove(widget.id)}
                  isFirst={index === 0}
                  isLast={index === widgets.length - 1}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

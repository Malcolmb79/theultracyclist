import { useEffect, useState } from "react";
import CyclistImage from "./CyclistImage";
import styles from "./CyclistLayer.module.css";

interface Rider {
  id: number;
  top: string;
  duration: number;
}

let nextId = 0;

export default function CyclistLayer() {
  const [riders, setRiders] = useState<Rider[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const timeouts: number[] = [];

    function spawn() {
      const id = nextId++;
      const top = `${10 + Math.random() * 70}%`;
      const duration = 11 + Math.random() * 6;
      setRiders((prev) => [...prev, { id, top, duration }]);
      const cleanup = window.setTimeout(() => {
        setRiders((prev) => prev.filter((r) => r.id !== id));
      }, duration * 1000);
      timeouts.push(cleanup);
    }

    function scheduleNext(delay: number) {
      const t = window.setTimeout(() => {
        spawn();
        scheduleNext(20000 + Math.random() * 25000);
      }, delay);
      timeouts.push(t);
    }

    scheduleNext(4000 + Math.random() * 4000);

    return () => timeouts.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <>
      {riders.map((rider) => (
        <div
          key={rider.id}
          className={styles.rider}
          style={{ top: rider.top, animationDuration: `${rider.duration}s` }}
          aria-hidden="true"
        >
          <CyclistImage />
        </div>
      ))}
    </>
  );
}

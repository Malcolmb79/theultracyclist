import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import RaceConsole from "../components/race/RaceConsole";
import { sauceAddressForModPage } from "../components/race/sauceFeed";
import { SITE } from "./site";
import styles from "./RaceMod.module.css";

// Entry point for the Sauce mod build (vite.sauce-mod.config.ts). Sauce
// serves this page itself, from the same address as its own API, so the
// console connects to whatever host the page was loaded from.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className={styles.page}>
      <h1 className={styles.title}>Ultra Cyclist Race</h1>
      <RaceConsole defaultAddress={sauceAddressForModPage()} apiBase={SITE} needsKey tacticsOverlay />
    </div>
  </StrictMode>,
);

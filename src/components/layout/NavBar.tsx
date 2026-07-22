import { useState } from "react";
import { NavLink } from "react-router-dom";
import { site } from "../../data/site";
import styles from "./NavBar.module.css";

export default function NavBar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Toggle navigation"
      >
        Menu
      </button>
      <nav className={[styles.nav, open ? styles.navOpen : ""].join(" ")}>
        {site.nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              [styles.link, isActive ? styles.linkActive : ""].join(" ")
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

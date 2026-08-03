import { Link } from "react-router-dom";
import { home } from "../../data/home";
import styles from "./PathCards.module.css";

/**
 * Three ways into the site, for a visitor who has read the story and doesn't
 * know what to do next. The whole card is the link rather than a "read more"
 * at the bottom of it - a card that looks clickable and only is in one corner
 * is a small, repeated irritation.
 */
export default function PathCards() {
  return (
    <div className={styles.grid}>
      {home.paths.map((path) => (
        <Link key={path.to} to={path.to} className={styles.card}>
          <span className="eyebrow">{path.eyebrow}</span>
          <h3 className={styles.title}>{path.title}</h3>
          <p className={styles.body}>{path.body}</p>
          <span className={styles.arrow} aria-hidden="true">
            &rarr;
          </span>
        </Link>
      ))}
    </div>
  );
}

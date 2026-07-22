import { Link } from "react-router-dom";
import { site } from "../../data/site";
import NavBar from "./NavBar";
import styles from "./Header.module.css";

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={["container", styles.inner].join(" ")}>
        <Link to="/" className={styles.brand}>
          <span className={styles.brandName}>{site.name}</span>
          <span className={styles.brandTag}>{site.athleteName}</span>
        </Link>
        <NavBar />
      </div>
    </header>
  );
}

import { about } from "../../data/about";
import styles from "./AboutBio.module.css";

export default function AboutBio() {
  return (
    <div className={styles.wrap}>
      <img className={styles.portrait} src={about.portraitImage} alt={about.name} />
      <div className={styles.body}>
        <h1>{about.name}</h1>
        <p className="eyebrow">{about.tagline}</p>
        {about.bioParagraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}

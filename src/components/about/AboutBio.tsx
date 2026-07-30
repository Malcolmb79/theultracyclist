import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { about } from "../../data/about";
import styles from "./AboutBio.module.css";

export default function AboutBio() {
  // The portrait chosen in Settings, if there is one. Starts as the bundled
  // placeholder so the page never renders with a gap while this is in flight,
  // and stays on it if nothing has been uploaded.
  const [portrait, setPortrait] = useState(about.portraitImage);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/site-portrait")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { portraitDataUrl?: string | null } | null) => {
        if (!cancelled && body?.portraitDataUrl) setPortrait(body.portraitDataUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.wrap}>
      <img className={styles.portrait} src={portrait} alt={about.name} />
      <div className={styles.body}>
        <h1>{about.name}</h1>
        <p className="eyebrow">{about.tagline}</p>
        {about.bioParagraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
        <p>
          <Link to="/previous-record">Read about the 2022 East-to-West record &rarr;</Link>
        </p>
      </div>
    </div>
  );
}

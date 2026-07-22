import { Link } from "react-router-dom";
import { site } from "../../data/site";
import { fundraiser } from "../../data/fundraiser";
import Button, { buttonClassName } from "../shared/Button";
import styles from "./Hero.module.css";

export default function Hero() {
  return (
    <section className={styles.hero}>
      <div className="container">
        <span className="eyebrow">New world record attempt</span>
        <h1 className={styles.title}>Cycling Ireland, North to South.</h1>
        <p className={styles.subtitle}>{site.tagline}</p>
        <div className={styles.actions}>
          <Button href={fundraiser.campaignUrl} target="_blank" rel="noopener noreferrer">
            Donate to the cause
          </Button>
          <Link to="/journey" className={buttonClassName("secondary")}>
            Follow the journey
          </Link>
        </div>
      </div>
    </section>
  );
}

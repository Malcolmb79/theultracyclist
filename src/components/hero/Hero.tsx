import { Link } from "react-router-dom";
import { home } from "../../data/home";
import { fundraiser } from "../../data/fundraiser";
import Button, { buttonClassName } from "../shared/Button";
import { useSitePhotos } from "../../utils/useSitePhotos";
import styles from "./Hero.module.css";

/**
 * Two hero designs in one component, chosen by whether a photograph exists.
 *
 * With a photo it is a full-bleed image behind the headline. Without one it
 * falls back to the original gradient and island outline rather than a grey
 * box or a stock cyclist - an empty frame reads as a broken page, and a
 * stranger on a bike reads as the athlete, which he isn't.
 */
export default function Hero() {
  const { hero } = useSitePhotos();

  return (
    <section className={[styles.hero, hero ? styles.withPhoto : ""].join(" ")}>
      {hero ? (
        <>
          <img className={styles.photo} src={hero} alt="" />
          {/* Two scrims rather than one: a vertical gradient to seat the text
              and a flat tint over the whole frame, so a bright sky doesn't
              take the headline with it. */}
          <div className={styles.scrim} aria-hidden="true" />
        </>
      ) : (
        <img className={styles.island} src="/images/ireland-relief.jpg" alt="" aria-hidden="true" />
      )}

      <div className={["container", styles.inner].join(" ")}>
        <span className="eyebrow">{home.hero.eyebrow}</span>
        <h1 className={styles.title}>{home.hero.title}</h1>
        <p className={styles.subtitle}>{home.hero.subtitle}</p>
        <div className={styles.actions}>
          <Button href={fundraiser.campaignUrl} target="_blank" rel="noopener noreferrer">
            Donate to the cause
          </Button>
          <Link to="/journey" className={buttonClassName("secondary")}>
            Follow the journey
          </Link>
        </div>

        <dl className={styles.facts}>
          {home.hero.facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

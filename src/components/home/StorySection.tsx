import { Link } from "react-router-dom";
import { home } from "../../data/home";
import { useSitePhotos } from "../../utils/useSitePhotos";
import styles from "./StorySection.module.css";

/**
 * The introduction the home page didn't have: who is riding, and why.
 *
 * The photograph is optional and the layout collapses to a single column
 * without it, rather than holding an empty frame open. Text first in the DOM
 * so that reading order and narrow screens both get the words before the
 * picture.
 */
export default function StorySection() {
  const { story } = useSitePhotos();

  return (
    <section className="section">
      <div className={["container", styles.wrap, story ? styles.withPhoto : ""].join(" ")}>
        <div className={styles.body}>
          <span className="eyebrow">{home.story.eyebrow}</span>
          <h2 className={styles.title}>{home.story.title}</h2>
          <p className={styles.lead}>{home.story.lead}</p>
          {home.story.paragraphs.map((paragraph, i) => (
            <p key={i} className={styles.paragraph}>
              {paragraph}
            </p>
          ))}
          <p className={styles.quote}>{home.story.pullQuote}</p>
          <p className={styles.more}>
            <Link to="/about">Read the full story &rarr;</Link>
          </p>
        </div>

        {story && (
          <figure className={styles.figure}>
            <img className={styles.photo} src={story} alt="" />
          </figure>
        )}
      </div>
    </section>
  );
}

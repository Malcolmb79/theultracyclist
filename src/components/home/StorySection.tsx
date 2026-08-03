import { Link } from "react-router-dom";
import { home } from "../../data/home";
import { useSitePhotos } from "../../utils/useSitePhotos";
import styles from "./StorySection.module.css";

/**
 * The introduction the home page didn't have: who is riding, and why.
 *
 * Two columns on a wide screen, headline and pull quote on the left and the
 * story itself on the right. An earlier version put everything in one centred
 * column, which filled the space but gave the section a different left margin
 * from the hero above it. Two edges half a screen apart read as a broken
 * page long before anyone works out why.
 *
 * The photograph is optional. Without one the two text columns simply take
 * the full width; with one they stack and it sits alongside.
 */
export default function StorySection() {
  const { story } = useSitePhotos();

  return (
    <section className="section">
      <div className={["container", styles.wrap, story ? styles.withPhoto : ""].join(" ")}>
        <div className={styles.headline}>
          <span className="eyebrow">{home.story.eyebrow}</span>
          <h2 className={styles.title}>{home.story.title}</h2>
          <p className={styles.quote}>{home.story.pullQuote}</p>
        </div>

        <div className={styles.body}>
          <p className={styles.lead}>{home.story.lead}</p>
          {home.story.paragraphs.map((paragraph, i) => (
            <p key={i} className={styles.paragraph}>
              {paragraph}
            </p>
          ))}
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

import { instagramPosts } from "../../data/instagramPosts";
import { useInstagramEmbedProcess } from "../../hooks/useInstagramEmbedProcess";
import InstagramEmbed from "./InstagramEmbed";
import styles from "./InstagramFeed.module.css";

export default function InstagramFeed() {
  useInstagramEmbedProcess([instagramPosts.length]);

  if (instagramPosts.length === 0) {
    return (
      <p className={styles.empty}>
        No featured posts yet — check back soon, or follow along live on Instagram.
      </p>
    );
  }

  return (
    <div className={styles.grid}>
      {instagramPosts.map((post) => (
        <InstagramEmbed key={post.url} post={post} />
      ))}
    </div>
  );
}

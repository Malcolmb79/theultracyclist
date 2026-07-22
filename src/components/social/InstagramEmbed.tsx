import type { InstagramPost } from "../../types/content";
import styles from "./InstagramEmbed.module.css";

interface InstagramEmbedProps {
  post: InstagramPost;
}

export default function InstagramEmbed({ post }: InstagramEmbedProps) {
  return (
    <div className={styles.wrap}>
      <blockquote
        className="instagram-media"
        data-instgrm-permalink={post.url}
        data-instgrm-version="14"
        style={{ margin: 0, width: "100%" }}
      >
        <a href={post.url} target="_blank" rel="noopener noreferrer">
          {post.caption ?? "View on Instagram"}
        </a>
      </blockquote>
    </div>
  );
}

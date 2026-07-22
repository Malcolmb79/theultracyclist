import styles from "./CyclistLayer.module.css";

export default function CyclistIcon() {
  return (
    <svg viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className={styles.wheel}>
        <circle cx="20" cy="45" r="10" stroke="currentColor" strokeWidth="2.5" />
        <line x1="20" y1="35" x2="20" y2="55" stroke="currentColor" strokeWidth="1.2" />
        <line x1="10" y1="45" x2="30" y2="45" stroke="currentColor" strokeWidth="1.2" />
        <line x1="13" y1="38" x2="27" y2="52" stroke="currentColor" strokeWidth="1.2" />
        <line x1="13" y1="52" x2="27" y2="38" stroke="currentColor" strokeWidth="1.2" />
      </g>
      <g className={styles.wheel}>
        <circle cx="75" cy="45" r="10" stroke="currentColor" strokeWidth="2.5" />
        <line x1="75" y1="35" x2="75" y2="55" stroke="currentColor" strokeWidth="1.2" />
        <line x1="65" y1="45" x2="85" y2="45" stroke="currentColor" strokeWidth="1.2" />
        <line x1="68" y1="38" x2="82" y2="52" stroke="currentColor" strokeWidth="1.2" />
        <line x1="68" y1="52" x2="82" y2="38" stroke="currentColor" strokeWidth="1.2" />
      </g>
      <path
        d="M20,45 L47,22 L75,45 M47,22 L59,20 M47,22 L44,32 L58,45"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="42" cy="9" r="5" fill="currentColor" />
      <path
        d="M42,14 L50,28 M50,28 L59,19 M50,28 L45,45 M50,28 L60,45"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

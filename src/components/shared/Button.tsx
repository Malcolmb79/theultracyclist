import type { AnchorHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary";

export function buttonClassName(variant: ButtonVariant = "primary", className?: string): string {
  const variantClass = variant === "primary" ? styles.primary : styles.secondary;
  return [styles.button, variantClass, className].filter(Boolean).join(" ");
}

interface ButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export default function Button({ variant = "primary", children, className, ...rest }: ButtonProps) {
  return (
    <a className={buttonClassName(variant, className)} {...rest}>
      {children}
    </a>
  );
}

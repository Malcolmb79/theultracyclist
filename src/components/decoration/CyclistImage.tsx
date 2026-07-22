import { useTransparentImage } from "../../hooks/useTransparentImage";

const CYCLIST_SRC = "/images/cyclist.jpg";

export default function CyclistImage() {
  const src = useTransparentImage(CYCLIST_SRC);
  return <img src={src} alt="" draggable={false} />;
}

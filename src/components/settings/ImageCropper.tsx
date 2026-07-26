import { useRef, useState, type PointerEvent } from "react";
import { cropImageToDataUrl } from "../../utils/resizeImage";
import styles from "./ImageCropper.module.css";

const VIEWPORT = 240; // on-screen crop square, px
const MAX_ZOOM = 3;

interface ImageCropperProps {
  image: HTMLImageElement;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

type Offset = { x: number; y: number };

// Lets the athlete choose which part of an uploaded photo becomes their
// profile picture, replacing a blind geometric-center crop that cut off
// faces whenever the subject wasn't dead-center in the source photo. The
// vignette mirrors the circular avatar the result is displayed as
// (ProfileMenu.module.css), so what's inside the circle here is what shows
// up there.
export default function ImageCropper({ image, onCancel, onConfirm }: ImageCropperProps) {
  const baseScale = VIEWPORT / Math.min(image.naturalWidth, image.naturalHeight);
  const [zoom, setZoom] = useState(1);
  const scale = baseScale * zoom;

  const clamp = (offset: Offset, atScale: number): Offset => {
    const w = image.naturalWidth * atScale;
    const h = image.naturalHeight * atScale;
    return {
      x: Math.min(0, Math.max(VIEWPORT - w, offset.x)),
      y: Math.min(0, Math.max(VIEWPORT - h, offset.y)),
    };
  };

  const [offset, setOffset] = useState<Offset>(() =>
    clamp({ x: (VIEWPORT - image.naturalWidth * baseScale) / 2, y: (VIEWPORT - image.naturalHeight * baseScale) / 2 }, baseScale),
  );
  const dragRef = useRef<{ startX: number; startY: number; base: Offset } | null>(null);

  const handleZoom = (nextZoom: number) => {
    setZoom(nextZoom);
    setOffset((prev) => clamp(prev, baseScale * nextZoom));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, base: offset };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { startX, startY, base } = dragRef.current;
    setOffset(clamp({ x: base.x + (e.clientX - startX), y: base.y + (e.clientY - startY) }, scale));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleConfirm = () => {
    const size = VIEWPORT / scale;
    onConfirm(cropImageToDataUrl(image, { x: -offset.x / scale, y: -offset.y / scale, size }));
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Crop profile picture">
      <div className={styles.panel}>
        <div
          className={styles.viewport}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            src={image.src}
            alt=""
            draggable={false}
            className={styles.image}
            style={{
              width: image.naturalWidth * scale,
              height: image.naturalHeight * scale,
              left: offset.x,
              top: offset.y,
            }}
          />
          <div className={styles.vignette} aria-hidden="true" />
        </div>

        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => handleZoom(Number(e.target.value))}
          className={styles.zoomSlider}
          aria-label="Zoom"
        />
        <p className={styles.hint}>Drag to reposition, use the slider to zoom.</p>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirmButton} onClick={handleConfirm}>
            Use this photo
          </button>
        </div>
      </div>
    </div>
  );
}

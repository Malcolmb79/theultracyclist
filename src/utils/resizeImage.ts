const OUTPUT_SIZE = 160;
const JPEG_QUALITY = 0.85;

export type CropRect = { x: number; y: number; size: number }; // source-image pixel space, square

// Loads a File into a decoded <img> - split out from the crop step below so
// ImageCropper.tsx can read the image's natural dimensions before the
// athlete picks a crop rectangle.
export function readImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the selected file as an image"));
      img.onload = () => resolve(img);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Crops `img` to the given square source-pixel rect (chosen by the athlete
// via ImageCropper.tsx - a blind geometric-center crop cut off faces on
// photos where the subject wasn't dead-center), resizes to a small fixed
// size, and encodes as a JPEG data URL - keeps a profile picture to a few KB
// regardless of the source photo's resolution, since it's stored directly
// inside the settings blob (see api/coaching-settings.ts) rather than in
// separate file storage.
export function cropImageToDataUrl(img: HTMLImageElement, crop: CropRect): string {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

// Progress photos are looked at rather than glanced at, so they keep far more
// detail than a 160px avatar — but still nothing like a phone camera's output,
// which would be several MB per angle and three angles per session.
const PHOTO_MAX_EDGE = 900;
const PHOTO_QUALITY = 0.72;

/**
 * Downscales a photo to a JPEG data URL, preserving its aspect ratio.
 *
 * Unlike the avatar path this doesn't crop: a progress photo compared against
 * another has to be the same framing as the one beside it, and cropping each
 * one separately is how two photos stop being comparable.
 */
export function photoToDataUrl(img: HTMLImageElement): string {
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}

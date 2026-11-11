// Product photos are taken on the phone (often 4000 px, several MB). Shrink
// them before upload: at most 1024 px on the long side, JPEG. That is
// plenty to recognise a pack on the shelf and keeps uploads fast on mobile
// data. It also strips the camera's metadata (location etc.).

export const MAX_SIDE = 1024;

export async function shrinkPhoto(file: Blob, maxSide = MAX_SIDE): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    // honour the EXIF rotation, so portrait shots stay upright
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("Couldn't read this photo. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Couldn't process this photo.");
  // white behind transparent PNGs, which JPEG can't store
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error("Couldn't process this photo.");
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

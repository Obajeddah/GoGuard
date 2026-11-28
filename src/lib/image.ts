/** Resize an image file in the browser to a compact JPEG data URL. */
export async function resizeImageToDataUrl(
  file: File,
  maxSize = 512,
  quality = 0.82,
): Promise<string> {
  if (!file.type.startsWith("image/"))
    throw new Error("Please choose a picture (JPG, PNG or WebP).");
  if (/hei[cf]/i.test(file.type) || /\.(hei[cf])$/i.test(file.name))
    throw new Error(
      "This phone's photo format can't be read here. Set your camera to \"Most Compatible\" or take a screenshot of the picture and upload that.",
    );
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error("That picture couldn't be opened. Please try a JPG or PNG photo."));
      el.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing is not supported on this device.");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta ?? "")?.[1] ?? "image/jpeg";
  const bin = atob(b64 ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

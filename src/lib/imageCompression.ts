/**
 * Client-side High-Performance Image Compression Utility
 * Compresses raw image files or base64 strings to a lightweight, responsive format
 * (JPEG, max width 800px, 0.6 quality) to optimize network payloads and prevent Firestore document bloat.
 */

export async function compressBase64Image(
  base64Str: string,
  maxWidth: number = 800,
  maxHeight: number = 800,
  quality: number = 0.6
): Promise<string> {
  return new Promise((resolve, reject) => {
    // If it's empty or invalid, return immediately
    if (!base64Str) {
      resolve("");
      return;
    }

    const img = new Image();
    img.src = base64Str.startsWith("data:") ? base64Str : `data:image/jpeg;base64,${base64Str}`;

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Calculate new dimensions keeping the aspect ratio
      if (width > maxHeight || height > maxHeight) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        // Fallback to original image if context creation failed
        resolve(base64Str);
        return;
      }

      // Draw and export compressed JPEG
      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
      
      // Return raw base64 data without data:image/jpeg;base64, prefix if that's what was passed initially
      if (!base64Str.startsWith("data:")) {
        const parts = compressedDataUrl.split(",");
        resolve(parts[1] || parts[0]);
      } else {
        resolve(compressedDataUrl);
      }
    };

    img.onerror = (err) => {
      console.warn("[Image Compression] Failed to load image details, returning original string", err);
      resolve(base64Str);
    };
  });
}

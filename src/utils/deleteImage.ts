import cloudinary from "../config/cloudinary";

export async function deleteImage(publicId?: string) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch {
    // ignore delete failures (image may already be gone)
  }
}
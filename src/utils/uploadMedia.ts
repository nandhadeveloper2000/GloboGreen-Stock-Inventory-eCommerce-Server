import cloudinary from "../config/cloudinary";

function getResourceType(mimeType?: string) {
  return String(mimeType || "").toLowerCase().startsWith("video/")
    ? "video"
    : "image";
}

export async function uploadMedia(file: Express.Multer.File, folder: string) {
  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: getResourceType(file.mimetype),
      },
      (error, result) => {
        if (error || !result?.secure_url || !result.public_id) {
          reject(error || new Error("Failed to upload media"));
          return;
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    stream.end(file.buffer);
  });
}

import multer from "multer";

type MemoryUploadOptions = {
  allowVideos?: boolean;
  allowAnyFiles?: boolean;
  maxFileSize?: number;
};

function createMemoryUpload(options?: MemoryUploadOptions) {
  const allowVideos = options?.allowVideos ?? false;
  const allowAnyFiles = options?.allowAnyFiles ?? false;
  const maxFileSize = options?.maxFileSize ?? 5 * 1024 * 1024;

  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSize,
    },
    fileFilter: (_req, file, cb) => {
      const mimeType = String(file.mimetype || "").toLowerCase();
      const isImage = /^image\/(png|jpe?g|webp)$/i.test(mimeType);
      const isVideo =
        /^video\/(mp4|webm|quicktime)$/i.test(mimeType) ||
        mimeType === "video/quicktime";

      const ok = allowAnyFiles || isImage || (allowVideos && isVideo);

      if (!ok) {
        return cb(
          new Error(
            allowAnyFiles
              ? "Invalid file upload"
              : allowVideos
                ? "Only image and video files are allowed"
                : "Only image files are allowed"
          )
        );
      }

      cb(null, true);
    },
  });
}

export const upload = createMemoryUpload();

export const productMediaUpload = createMemoryUpload({
  allowVideos: true,
  allowAnyFiles: true,
  maxFileSize: 25 * 1024 * 1024,
});

import cloudinary from "../config/cloudinary";

export async function uploadImage(file: Express.Multer.File, folder: string) {
  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;
  const res = await cloudinary.uploader.upload(dataUri, { folder, resource_type: "image" });

  return { url: res.secure_url, publicId: res.public_id };
}
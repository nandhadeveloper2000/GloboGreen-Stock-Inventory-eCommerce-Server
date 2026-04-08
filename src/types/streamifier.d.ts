declare module "streamifier" {
  import { Readable } from "stream";

  export interface StreamifierOptions {
    highWaterMark?: number;
    encoding?: BufferEncoding;
  }

  export function createReadStream(
    object: any,
    options?: StreamifierOptions
  ): Readable;
}
import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { ContentService } from "../content/content.service";
import { PROJECT_IMAGE_BUCKET, projectImageUrl } from "../content/project-images";

export const PROJECT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

type ImageType = { ext: "png" | "jpg" | "webp"; mime: string };

/**
 * What the bytes actually are — the file name and the declared type aren't
 * trusted. Only raster formats browsers display as images; SVG (which can
 * carry scripts) and everything else is refused.
 */
function sniffImage(buf: Buffer): ImageType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

/**
 * Project screenshots in a PUBLIC Storage bucket (they're shown on the site),
 * which only this API can write to. Every upload gets a fresh random name
 * (<project id>/<32 hex>.<ext>), so names can't be chosen or guessed in
 * advance and browsers can cache each file forever. Replaced or orphaned
 * files are deleted.
 */
@Injectable()
export class ProjectImagesService {
  private readonly logger = new Logger(ProjectImagesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly content: ContentService
  ) {}

  private get db() {
    if (!this.supabase.client) throw new ServiceUnavailableException("Supabase isn't configured.");
    return this.supabase.client;
  }

  /** Stores the image and points the project at it. Returns the project name (for the activity log). */
  async replace(projectId: string, file: Buffer) {
    const type = sniffImage(file);
    if (!type) throw new BadRequestException("Use a PNG, JPG, or WebP image.");

    const current = await this.current(projectId);
    await this.ensureBucket();
    const path = `${projectId}/${randomBytes(16).toString("hex")}.${type.ext}`;
    const upload = await this.db.storage.from(PROJECT_IMAGE_BUCKET).upload(path, file, {
      contentType: type.mime,
      cacheControl: "31536000",
      upsert: false,
    });
    if (upload.error) {
      this.logger.error(`Image upload failed: ${upload.error.message}`);
      throw new InternalServerErrorException("Couldn't store the image. Please try again.");
    }

    const { error } = await this.db.from("projects").update({ image_path: path, updated_at: new Date().toISOString() }).eq("id", projectId);
    if (error) {
      await this.deleteObject(path); // don't leave an orphan behind
      this.fail(error);
    }
    if (current.image_path) await this.deleteObject(current.image_path);
    this.content.invalidate();
    return { name: current.name, imageUrl: projectImageUrl(path) };
  }

  async remove(projectId: string) {
    const current = await this.current(projectId);
    if (!current.image_path) return current.name;
    const { error } = await this.db.from("projects").update({ image_path: null, updated_at: new Date().toISOString() }).eq("id", projectId);
    if (error) this.fail(error);
    await this.deleteObject(current.image_path);
    this.content.invalidate();
    return current.name;
  }

  /** Best effort: a leftover file is harmless, so failures are only logged. */
  async deleteObject(path: string) {
    const { error } = await this.db.storage.from(PROJECT_IMAGE_BUCKET).remove([path]);
    if (error) this.logger.warn(`Couldn't delete old image ${path}: ${error.message}`);
  }

  private async current(projectId: string) {
    const { data, error } = await this.db.from("projects").select("name, image_path").eq("id", projectId).maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundException();
    return data as { name: string; image_path: string | null };
  }

  private fail(error: { code?: string; message: string }): never {
    if (error.code === "42703" || error.code === "PGRST204") {
      throw new ServiceUnavailableException("Project images need the latest database setup — re-run supabase/schema.sql.");
    }
    this.logger.error(`${error.code ?? ""} ${error.message}`);
    throw new InternalServerErrorException("The database couldn't complete that request.");
  }

  /** Creates the bucket on first use; Storage itself also enforces the types and size. */
  private async ensureBucket() {
    const existing = await this.db.storage.getBucket(PROJECT_IMAGE_BUCKET);
    if (!existing.error) return;
    const { error } = await this.db.storage.createBucket(PROJECT_IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: PROJECT_IMAGE_MAX_BYTES,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    if (error && !/already exists/i.test(error.message)) {
      this.logger.error(`Couldn't create the image bucket: ${error.message}`);
      throw new InternalServerErrorException("Couldn't prepare image storage.");
    }
  }
}

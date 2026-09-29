import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { FrontendRevalidator } from "../common/frontend-revalidator";

export const CV_MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "cv";
const OBJECT = "Austin_Yang_CV.pdf";
const CACHE_MS = 5 * 60_000;

export interface CvInfo {
  size: number;
  updatedAt: string | null;
}

/**
 * The downloadable CV, stored in a PRIVATE Supabase Storage bucket: nobody can
 * read or write it except this API (service role). Visitors get it through
 * GET /cv; the admin replaces it through PUT /admin/cv. Always stored under
 * one fixed name, so an upload can never choose its own path.
 */
@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);
  private cache: { file: Buffer; at: number } | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly frontend: FrontendRevalidator
  ) {}

  private get storage() {
    if (!this.supabase.client) throw new ServiceUnavailableException("Supabase isn't configured.");
    return this.supabase.client.storage;
  }

  /** The current CV, or null when none has been uploaded yet. */
  async download(): Promise<Buffer | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.file;
    const { data, error } = await this.storage.from(BUCKET).download(OBJECT);
    if (error || !data) return null;
    const file = Buffer.from(await data.arrayBuffer());
    this.cache = { file, at: Date.now() };
    return file;
  }

  async info(): Promise<CvInfo | null> {
    const { data, error } = await this.storage.from(BUCKET).list("", { search: OBJECT, limit: 1 });
    const object = error ? undefined : data.find((o) => o.name === OBJECT);
    if (!object) return null;
    return { size: Number(object.metadata?.size ?? 0), updatedAt: object.updated_at ?? object.created_at ?? null };
  }

  /** Replaces the CV. The caller has already checked it's a real PDF within the size limit. */
  async replace(file: Buffer): Promise<CvInfo | null> {
    await this.ensureBucket();
    const { error } = await this.storage.from(BUCKET).upload(OBJECT, file, {
      contentType: "application/pdf",
      upsert: true,
      cacheControl: "300",
    });
    if (error) {
      this.logger.error(`CV upload failed: ${error.message}`);
      throw new InternalServerErrorException("Couldn't store the new CV. Please try again.");
    }
    this.cache = { file, at: Date.now() };
    this.frontend.revalidate("cv");
    return this.info();
  }

  /** Creates the private bucket on first use; Storage itself also enforces type and size. */
  private async ensureBucket() {
    const existing = await this.storage.getBucket(BUCKET);
    if (!existing.error) return;
    const { error } = await this.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: CV_MAX_BYTES,
      allowedMimeTypes: ["application/pdf"],
    });
    if (error && !/already exists/i.test(error.message)) {
      this.logger.error(`Couldn't create the CV bucket: ${error.message}`);
      throw new InternalServerErrorException("Couldn't prepare CV storage.");
    }
  }
}

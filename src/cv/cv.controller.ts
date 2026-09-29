import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { OriginGuard } from "../common/origin.guard";
import { AdminGuard } from "../admin/admin.guard";
import { CV_MAX_BYTES, CvService } from "./cv.service";

const PDF_MAGIC = Buffer.from("%PDF-");

@Controller()
export class CvController {
  constructor(private readonly cv: CvService) {}

  /** Public download. The frontend serves this at /Austin_Yang_CV.pdf. */
  @Get("cv")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async download(@Res() res: Response) {
    const file = await this.cv.download();
    if (!file) throw new NotFoundException("No CV has been uploaded yet.");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Austin_Yang_CV.pdf"',
      "Content-Length": String(file.length),
      "Cache-Control": "public, max-age=300",
    });
    res.send(file);
  }

  /** `{ current: null }` when nothing has been uploaded yet (a bare null would be an empty body). */
  @Get("admin/cv")
  @UseGuards(OriginGuard, AdminGuard)
  async info() {
    return { current: await this.cv.info() };
  }

  /**
   * Replaces the CV. Guards run before the upload is read, so only the admin
   * can send a file at all. Multer keeps it in memory with hard limits (one
   * file, 5 MB, no other fields); then the bytes must really be a PDF — the
   * declared type or file name alone isn't trusted.
   */
  @Put("admin/cv")
  @UseGuards(OriginGuard, AdminGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: CV_MAX_BYTES, files: 1, fields: 0, parts: 1 },
    })
  )
  async replace(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException("Choose a PDF file to upload.");
    const looksLikePdf = file.mimetype === "application/pdf" && file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
    if (!looksLikePdf) throw new BadRequestException("That file isn't a PDF.");
    return { current: await this.cv.replace(file.buffer) };
  }
}

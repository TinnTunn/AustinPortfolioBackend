import { Controller, Get, Header } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ContentService } from "./content.service";

/** Public, read-only: the published Experience and Projects, both languages. */
@Controller("content")
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @SkipThrottle() // read by the frontend server, cached there
  @Header("Cache-Control", "no-store")
  get() {
    return this.content.published();
  }
}

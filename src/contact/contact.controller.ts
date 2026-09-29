import { BadGatewayException, Body, Controller, HttpCode, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { OriginGuard } from "../common/origin.guard";
import { ContactDto } from "./contact.dto";
import { ContactService } from "./contact.service";

@Controller("contact")
@UseGuards(OriginGuard)
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  async submit(@Body() dto: ContactDto) {
    // Pretend success for bots so they don't learn to skip the honeypot.
    if (dto.website?.trim()) return { ok: true };

    const result = await this.contact.submit({ name: dto.name, email: dto.email, message: dto.message });
    if (result === "notConnected") throw new ServiceUnavailableException({ code: "notConnected" });
    if (result === "failed") throw new BadGatewayException({ code: "failed" });
    return { ok: true };
  }
}

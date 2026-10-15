import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { IsBoolean, IsIn, IsISO8601, IsOptional } from "class-validator";
import { SupabaseService } from "../supabase/supabase.service";
import { OriginGuard } from "../common/origin.guard";
import { ActivityService } from "../activity/activity.service";
import { AdminGuard } from "./admin.guard";

const PAGE_SIZE = 30;
const COLUMNS = "id, name, email, message, created_at, read_at";

class InboxQueryDto {
  /** Cursor: only messages older than this timestamp. */
  @IsOptional() @IsISO8601({ strict: true }) before?: string;
  @IsOptional() @IsIn(["all", "unread"]) filter?: "all" | "unread";
}

class MarkReadDto {
  @IsBoolean() read: boolean;
}

/**
 * The contact-form inbox. Messages are written by strangers, so they're only
 * ever returned as data — the admin UI renders them as plain text.
 */
@Injectable()
export class AdminInboxService {
  private readonly logger = new Logger(AdminInboxService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    if (!this.supabase.client) throw new ServiceUnavailableException("Supabase isn't configured.");
    return this.supabase.client;
  }

  private fail(error: { code?: string; message: string }): never {
    if (error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST205") {
      throw new ServiceUnavailableException("The inbox needs the latest database setup — re-run supabase/schema.sql.");
    }
    this.logger.error(`${error.code ?? ""} ${error.message}`);
    throw new InternalServerErrorException("The database couldn't complete that request.");
  }

  async list({ before, filter }: InboxQueryDto) {
    let query = this.db.from("contact_messages").select(COLUMNS).order("created_at", { ascending: false }).limit(PAGE_SIZE + 1);
    if (before) query = query.lt("created_at", before);
    if (filter === "unread") query = query.is("read_at", null);
    const { data, error } = await query;
    if (error) this.fail(error);
    const items = data.slice(0, PAGE_SIZE);
    return {
      items,
      nextBefore: data.length > PAGE_SIZE ? (items[items.length - 1].created_at as string) : null,
      ...(await this.summary()),
    };
  }

  async summary() {
    const count = async (unreadOnly: boolean) => {
      let query = this.db.from("contact_messages").select("id", { count: "exact", head: true });
      if (unreadOnly) query = query.is("read_at", null);
      const { count: n, error } = await query;
      if (error) this.fail(error);
      // A HEAD count on a missing column comes back without an error but with no count.
      if (n === null) this.fail({ code: "42703", message: "no count returned" });
      return n;
    };
    const [unread, total] = await Promise.all([count(true), count(false)]);
    return { unread, total };
  }

  async markRead(id: string, read: boolean) {
    const { data, error } = await this.db.from("contact_messages")
      .update({ read_at: read ? new Date().toISOString() : null }).eq("id", id).select("id");
    if (error) this.fail(error);
    if (data.length !== 1) throw new NotFoundException();
  }

  /** Returns the sender's name, for the activity log. */
  async remove(id: string) {
    const { data, error } = await this.db.from("contact_messages").delete().eq("id", id).select("name");
    if (error) this.fail(error);
    if (data.length !== 1) throw new NotFoundException();
    return data[0].name as string;
  }
}

@Controller("admin/messages")
@UseGuards(OriginGuard, AdminGuard)
export class AdminInboxController {
  constructor(
    private readonly inbox: AdminInboxService,
    private readonly activity: ActivityService
  ) {}

  @Get() list(@Query() query: InboxQueryDto) { return this.inbox.list(query); }
  @Get("summary") summary() { return this.inbox.summary(); }

  @Patch(":id/read")
  @HttpCode(204)
  markRead(@Param("id", new ParseUUIDPipe()) id: string, @Body() dto: MarkReadDto) {
    return this.inbox.markRead(id, dto.read);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: Request) {
    const name = await this.inbox.remove(id);
    this.activity.log("message.delete", `Deleted a message from ${name}`, req);
  }
}

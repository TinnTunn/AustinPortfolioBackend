import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { SupabaseService } from "../supabase/supabase.service";
import { env } from "../config/env";

interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

type ContactResult = "sent" | "notConnected" | "failed";

/**
 * Saves a contact message to Supabase and emails it via Resend in parallel.
 * Either one succeeding counts as delivered, so a paused database doesn't
 * lose the visitor's message.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private readonly resend = env().resendApiKey ? new Resend(env().resendApiKey!) : null;

  constructor(private readonly supabase: SupabaseService) {}

  async submit(msg: ContactMessage): Promise<ContactResult> {
    const [saved, emailed] = await Promise.allSettled([this.save(msg), this.email(msg)]);
    if (saved.status === "rejected") this.logger.error(`Insert failed: ${(saved.reason as Error).message}`);
    if (emailed.status === "rejected") this.logger.error(`Email failed: ${(emailed.reason as Error).message}`);

    const results = [saved, emailed];
    if (results.some((r) => r.status === "fulfilled" && r.value)) return "sent";
    // Nothing threw, so neither channel is configured at all.
    return results.every((r) => r.status === "fulfilled") ? "notConnected" : "failed";
  }

  /** false when Supabase isn't configured; throws on a database error. */
  private async save(msg: ContactMessage) {
    const db = this.supabase.client;
    if (!db) return false;
    const { error } = await db.from("contact_messages").insert(msg);
    if (error) throw new Error(error.message);
    return true;
  }

  /** false when email isn't configured; throws when Resend rejects the send. */
  private async email({ name, email, message }: ContactMessage) {
    const to = env().contactNotifyEmail;
    if (!this.resend || !to) return false;
    const { error } = await this.resend.emails.send({
      from: "Portfolio Contact <onboarding@resend.dev>",
      to,
      subject: `New message from ${name}`,
      replyTo: email,
      text: [`Name: ${name}`, `Email: ${email}`, "", "Message:", message].join("\n"),
    });
    // The SDK returns errors instead of throwing, so they'd otherwise vanish.
    if (error) throw new Error(`${error.name}: ${error.message}`);
    return true;
  }
}

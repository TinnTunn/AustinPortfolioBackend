import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";
import { Text } from "../common/validation";

export class ContactDto {
  @Text(120, { required: true }) name: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsEmail({}, { message: "That email address doesn't look right." })
  @MaxLength(200, { message: "Keep it under 200 characters." })
  email: string;

  @Text(4000, { required: true, multiline: true }) message: string;

  /** Honeypot: hidden from people, so only bots fill it in. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

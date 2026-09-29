import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/** Sent by the frontend server (never the browser) for each page view. */
export class VisitDto {
  @IsString() @MaxLength(64) ip: string;
  @IsString() @MaxLength(512) ua: string;
  @IsOptional() @IsString() @MaxLength(512) referrer?: string;
  @IsOptional() @IsString() @MaxLength(255) host?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @IsIn(["en", "id"]) lang: "en" | "id";
}

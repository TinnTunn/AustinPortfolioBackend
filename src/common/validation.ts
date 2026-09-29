import { applyDecorators, BadRequestException, ValidationPipe, type ValidationError } from "@nestjs/common";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from "class-validator";

/**
 * Input hygiene shared by every DTO. Text is trimmed and stripped of control
 * characters; everything is length-capped; links must be absolute http(s)
 * URLs, which rules out `javascript:` / `data:` links. The global pipe also
 * rejects any property a DTO doesn't declare (no mass assignment).
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(value: unknown, multiline = false) {
  if (typeof value !== "string") return value;
  const text = value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").trim();
  return multiline ? text : text.replace(/\s*\n\s*/g, " ");
}

function cleanList(value: unknown, stripBullets: boolean) {
  if (!Array.isArray(value)) return value;
  const items = value
    .map((v) => cleanText(v))
    .filter((v): v is string => typeof v === "string")
    .map((v) => (stripBullets ? v.replace(/^[-•*]\s*/, "") : v))
    .filter(Boolean);
  return [...new Set(items)];
}

/** A text field. Optional ones default to "" so columns stay NOT NULL. */
export function Text(max: number, { required = false, multiline = false } = {}) {
  return applyDecorators(
    Transform(({ value }) => cleanText(value ?? "", multiline)),
    IsString({ message: "Must be text." }),
    ...(required ? [IsNotEmpty({ message: "Required." })] : []),
    MaxLength(max, { message: `Keep it under ${max} characters.` })
  );
}

/** A list of lines (bullet points). */
export function Lines(maxItems: number, maxLength: number, { required = false } = {}) {
  return applyDecorators(
    Transform(({ value }) => cleanList(value ?? [], true)),
    IsArray({ message: "Must be a list." }),
    ...(required ? [ArrayMinSize(1, { message: "Add at least one line." })] : []),
    ArrayMaxSize(maxItems, { message: `Use at most ${maxItems} lines.` }),
    IsString({ each: true }),
    MaxLength(maxLength, { each: true, message: `Keep each line under ${maxLength} characters.` })
  );
}

/** Short labels such as tags or a tech stack. */
export function Labels(maxItems: number, maxLength: number) {
  return applyDecorators(
    Transform(({ value }) => cleanList(value ?? [], false)),
    IsArray({ message: "Must be a list." }),
    ArrayMaxSize(maxItems, { message: `Use at most ${maxItems} items.` }),
    IsString({ each: true }),
    MaxLength(maxLength, { each: true, message: `Keep each item under ${maxLength} characters.` })
  );
}

/** Optional absolute http(s) link; empty becomes null. */
export function Link() {
  return applyDecorators(
    Transform(({ value }) => {
      const text = cleanText(value);
      return text === "" || text === undefined ? null : text;
    }),
    IsOptional(),
    IsUrl(
      { protocols: ["http", "https"], require_protocol: true, require_tld: false, disallow_auth: true },
      { message: "Use a full link starting with https://" }
    ),
    MaxLength(300, { message: "Keep the link under 300 characters." })
  );
}

function flatten(errors: ValidationError[], prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const error of errors) {
    const key = prefix ? `${prefix}.${error.property}` : error.property;
    const first = error.constraints && Object.values(error.constraints)[0];
    if (first) out[key] = first.startsWith("property ") ? "This field isn't allowed." : first;
    if (error.children?.length) Object.assign(out, flatten(error.children, key));
  }
  return out;
}

export function createValidationPipe() {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
    exceptionFactory: (errors) =>
      new BadRequestException({ message: "Please fix the highlighted fields.", fieldErrors: flatten(errors) }),
  });
}

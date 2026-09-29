import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { Labels, Lines, Link, Text } from "../common/validation";

export class LoginDto {
  @IsEmail({}, { message: "Enter a valid email." })
  @MaxLength(200)
  email: string;

  // Not trimmed or cleaned: passwords are compared exactly as typed.
  @IsString()
  @IsNotEmpty({ message: "Enter your password." })
  @MaxLength(200)
  password: string;
}

export class ExperienceDto {
  @IsBoolean() published: boolean;
  @Text(120, { required: true }) org: string;
  @Link() href: string | null;
  @Labels(10, 30) tags: string[];
  @Text(120, { required: true }) role_en: string;
  @Text(120) role_id: string;
  @Text(60, { required: true }) period_en: string;
  @Text(60) period_id: string;
  @Text(200, { required: true }) context_en: string;
  @Text(200) context_id: string;
  @Lines(8, 400, { required: true }) points_en: string[];
  @Lines(8, 400) points_id: string[];
}

const LONG = { multiline: true };

export class ProjectDto {
  @IsBoolean() published: boolean;
  @Text(80, { required: true }) name: string;
  @Link() href: string | null;
  @Labels(10, 30) stack: string[];
  @Text(120, { required: true }) role_en: string;
  @Text(120) role_id: string;
  @Text(40, { required: true }) status_en: string;
  @Text(40) status_id: string;
  @Text(400, { required: true, ...LONG }) summary_en: string;
  @Text(400, LONG) summary_id: string;
  @Text(800, { required: true, ...LONG }) problem_en: string;
  @Text(800, LONG) problem_id: string;
  @Text(800, { required: true, ...LONG }) solution_en: string;
  @Text(800, LONG) solution_id: string;
  @Text(800, { required: true, ...LONG }) contribution_en: string;
  @Text(800, LONG) contribution_id: string;
  @Text(800, { required: true, ...LONG }) lessons_en: string;
  @Text(800, LONG) lessons_id: string;
}

export class MoveDto {
  @IsIn(["up", "down"]) direction: "up" | "down";
}

export class PublishDto {
  @IsBoolean() published: boolean;
}

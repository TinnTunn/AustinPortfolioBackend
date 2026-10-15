import { applyDecorators } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, Matches, ValidateNested } from "class-validator";
import { Labels, Lines, Text } from "../common/validation";

/**
 * Editable text for the Hero, About, Skills, and Goals sections. Same rules as
 * the rest of the CMS: every field is length-capped and cleaned, every list
 * has a maximum size, and unknown properties are rejected (nested ones too).
 * Indonesian (`_id`) fields may be empty — the site then shows the English.
 */

/** A list of nested objects, each validated by its own class. */
function Nested(type: () => new () => object, min: number, max: number) {
  return applyDecorators(
    IsArray({ message: "Must be a list." }),
    ArrayMinSize(min, { message: `Add at least ${min}.` }),
    ArrayMaxSize(max, { message: `Use at most ${max}.` }),
    ValidateNested({ each: true }),
    Type(type)
  );
}

/** Non-empty list of short labels. */
const RequiredLabels = (maxItems: number, maxLength: number) =>
  applyDecorators(Labels(maxItems, maxLength), ArrayMinSize(1, { message: "Add at least one." }));

export class HeroSectionDto {
  @Text(120, { required: true }) title_en: string;
  @Text(120) title_id: string;
  @Text(700, { required: true }) lede_en: string;
  @Text(700) lede_id: string;
  @RequiredLabels(4, 40) roles_en: string[];
  @Labels(4, 40) roles_id: string[];
}

class StatDto {
  @Text(10, { required: true }) value: string;
  @Text(40, { required: true }) label_en: string;
  @Text(40) label_id: string;
}

export class AboutSectionDto {
  @Text(120, { required: true }) title_en: string;
  @Text(120) title_id: string;
  @Lines(4, 700, { required: true }) paras_en: string[];
  @Lines(4, 700) paras_id: string[];
  @Nested(() => StatDto, 0, 4) stats: StatDto[];
}

class SkillGroupDto {
  // Shown as a code identifier (e.g. `frameworks:`), so keep it one.
  @Matches(/^[a-z][A-Za-z0-9_]{0,23}$/, { message: "Use a short lowercase name like frameworks or data." })
  name: string;

  @RequiredLabels(12, 30) items: string[];
}

export class SkillsSectionDto {
  @RequiredLabels(16, 30) languages: string[];
  @Nested(() => SkillGroupDto, 1, 6) frontend: SkillGroupDto[];
  @Nested(() => SkillGroupDto, 1, 6) backend: SkillGroupDto[];
  @Nested(() => SkillGroupDto, 1, 6) devops: SkillGroupDto[];
}

class GoalDto {
  @Text(60, { required: true }) title_en: string;
  @Text(60) title_id: string;
  @Text(240, { required: true }) desc_en: string;
  @Text(240) desc_id: string;
}

export class GoalsSectionDto {
  @Text(120, { required: true }) title_en: string;
  @Text(120) title_id: string;
  @Nested(() => GoalDto, 1, 4) items: GoalDto[];
}

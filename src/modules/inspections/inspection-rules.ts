export type InspectionResponseType =
  | "YES_NO"
  | "PASS_FAIL"
  | "TEXT"
  | "NUMBER"
  | "ODOMETER"
  | "PHOTO"
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "CHECKBOX"
  | "SIGNATURE";

export type ResponseOutcome = "PASS" | "FAIL" | "NEUTRAL";
export type CommentRule = "NEVER" | "OPTIONAL" | "REQUIRED_ON_TRIGGER";
export type PhotoRequirement = "NEVER" | "ALWAYS" | "ON_FAILURE";

export type QuestionOptionRule = Readonly<{ id: string; isFailure: boolean }>;
export type InspectionQuestionRule = Readonly<{
  id: string;
  responseType: InspectionResponseType;
  isRequired: boolean;
  failureBooleanValue: boolean | null;
  minimumValue: number | null;
  maximumValue: number | null;
  commentRule: CommentRule;
  photoRequirement: PhotoRequirement;
  options: readonly QuestionOptionRule[];
}>;

export type ResponseInput = Readonly<{
  booleanValue?: boolean | null;
  textValue?: string | null;
  numberValue?: number | null;
  odometerValueKm?: number | null;
  optionIds?: readonly string[];
  fileCount?: number;
  comment?: string | null;
}>;

export type DerivedResponse = Readonly<{
  outcome: ResponseOutcome;
  requiresComment: boolean;
  requiresPhoto: boolean;
}>;

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value);
}

function supplied(value: unknown) {
  return value !== undefined && value !== null;
}

function selectedOptions(question: InspectionQuestionRule, input: ResponseInput) {
  const ids = [...new Set(input.optionIds ?? [])];
  const known = new Map(question.options.map((option) => [option.id, option]));
  if (ids.some((id) => !known.has(id)))
    return { ids, invalid: true, selected: [] as QuestionOptionRule[] };
  return { ids, invalid: false, selected: ids.map((id) => known.get(id)!) };
}

export function responseHasValue(question: InspectionQuestionRule, input: ResponseInput) {
  switch (question.responseType) {
    case "YES_NO":
    case "PASS_FAIL":
    case "CHECKBOX":
      return typeof input.booleanValue === "boolean";
    case "TEXT":
      return hasText(input.textValue);
    case "NUMBER":
      return finite(input.numberValue);
    case "ODOMETER":
      return Number.isInteger(input.odometerValueKm) && (input.odometerValueKm ?? -1) >= 0;
    case "SINGLE_CHOICE":
      return selectedOptions(question, input).ids.length === 1;
    case "MULTI_CHOICE":
      return selectedOptions(question, input).ids.length > 0;
    case "PHOTO":
    case "SIGNATURE":
      return (input.fileCount ?? 0) > 0;
  }
}

export function validateResponse(question: InspectionQuestionRule, input: ResponseInput): string[] {
  const errors: string[] = [];
  const selection = selectedOptions(question, input);
  const hasOptions = (input.optionIds ?? []).length > 0;
  const booleanQuestion = ["YES_NO", "PASS_FAIL", "CHECKBOX"].includes(question.responseType);
  if (!booleanQuestion && supplied(input.booleanValue)) errors.push("INVALID_RESPONSE_VALUE_TYPE");
  if (question.responseType !== "TEXT" && supplied(input.textValue))
    errors.push("INVALID_RESPONSE_VALUE_TYPE");
  if (question.responseType !== "NUMBER" && supplied(input.numberValue))
    errors.push("INVALID_RESPONSE_VALUE_TYPE");
  if (question.responseType !== "ODOMETER" && supplied(input.odometerValueKm))
    errors.push("INVALID_RESPONSE_VALUE_TYPE");
  if (
    question.responseType !== "SINGLE_CHOICE" &&
    question.responseType !== "MULTI_CHOICE" &&
    hasOptions
  )
    errors.push("INVALID_RESPONSE_VALUE_TYPE");
  if (selection.invalid) errors.push("INVALID_OPTION_SELECTION");
  if (question.responseType === "SINGLE_CHOICE" && selection.ids.length > 1)
    errors.push("SINGLE_CHOICE_REQUIRES_ONE_OPTION");
  if (
    question.responseType === "ODOMETER" &&
    input.odometerValueKm != null &&
    !responseHasValue(question, input)
  )
    errors.push("INVALID_ODOMETER_VALUE");
  if (question.responseType === "NUMBER" && input.numberValue != null && !finite(input.numberValue))
    errors.push("INVALID_NUMBER_VALUE");
  if (question.isRequired && !responseHasValue(question, input))
    errors.push("REQUIRED_RESPONSE_MISSING");
  return errors;
}

export function deriveResponse(
  question: InspectionQuestionRule,
  input: ResponseInput,
): DerivedResponse {
  const selection = selectedOptions(question, input);
  let outcome: ResponseOutcome = "NEUTRAL";
  if (responseHasValue(question, input) && !selection.invalid) {
    switch (question.responseType) {
      case "PASS_FAIL":
        outcome = input.booleanValue === false ? "FAIL" : "PASS";
        break;
      case "YES_NO":
      case "CHECKBOX":
        outcome =
          question.failureBooleanValue === null
            ? "NEUTRAL"
            : input.booleanValue === question.failureBooleanValue
              ? "FAIL"
              : "PASS";
        break;
      case "SINGLE_CHOICE":
      case "MULTI_CHOICE":
        outcome = selection.selected.some((option) => option.isFailure) ? "FAIL" : "PASS";
        break;
      case "NUMBER":
      case "ODOMETER": {
        const value =
          question.responseType === "NUMBER" ? input.numberValue! : input.odometerValueKm!;
        const outside =
          (question.minimumValue !== null && value < question.minimumValue) ||
          (question.maximumValue !== null && value > question.maximumValue);
        outcome =
          question.minimumValue === null && question.maximumValue === null
            ? "NEUTRAL"
            : outside
              ? "FAIL"
              : "PASS";
        break;
      }
      default:
        outcome = "NEUTRAL";
    }
  }
  return {
    outcome,
    requiresComment: question.commentRule === "REQUIRED_ON_TRIGGER" && outcome === "FAIL",
    requiresPhoto:
      question.photoRequirement === "ALWAYS" ||
      (question.photoRequirement === "ON_FAILURE" && outcome === "FAIL"),
  };
}

export function validateSubmissionResponse(question: InspectionQuestionRule, input: ResponseInput) {
  const errors = validateResponse(question, input);
  const derived = deriveResponse(question, input);
  if (derived.requiresComment && !hasText(input.comment)) errors.push("TRIGGERED_COMMENT_REQUIRED");
  if (derived.requiresPhoto && (input.fileCount ?? 0) === 0)
    errors.push("TRIGGERED_PHOTO_REQUIRED");
  return { errors, derived };
}

export type PublicationSection = Readonly<{
  id: string;
  questions: readonly InspectionQuestionRule[];
}>;

export function validateTemplatePublication(sections: readonly PublicationSection[]): string[] {
  const errors: string[] = [];
  if (sections.length === 0) errors.push("TEMPLATE_HAS_NO_SECTIONS");
  let odometerQuestionCount = 0;
  for (const section of sections) {
    if (section.questions.length === 0) errors.push(`SECTION_${section.id}_EMPTY`);
    for (const question of section.questions) {
      if (question.responseType === "ODOMETER") odometerQuestionCount += 1;
      if (
        (question.responseType === "SINGLE_CHOICE" || question.responseType === "MULTI_CHOICE") &&
        question.options.length < 2
      )
        errors.push(`QUESTION_${question.id}_CHOICES_INVALID`);
      if (
        (question.responseType === "NUMBER" || question.responseType === "ODOMETER") &&
        question.minimumValue !== null &&
        question.maximumValue !== null &&
        question.minimumValue > question.maximumValue
      )
        errors.push(`QUESTION_${question.id}_RANGE_INVALID`);
      if (
        !["YES_NO", "CHECKBOX"].includes(question.responseType) &&
        question.failureBooleanValue !== null
      )
        errors.push(`QUESTION_${question.id}_FAILURE_CONFIGURATION_INVALID`);
    }
  }
  if (odometerQuestionCount > 1) errors.push("TEMPLATE_HAS_MULTIPLE_ODOMETER_QUESTIONS");
  return errors;
}

export function deriveInspectionOutcome(outcomes: readonly ResponseOutcome[]): "PASS" | "FAIL" {
  return outcomes.includes("FAIL") ? "FAIL" : "PASS";
}

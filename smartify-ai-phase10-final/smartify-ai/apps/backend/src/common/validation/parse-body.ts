import { BadRequestException } from "@nestjs/common";
type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { flatten(): { fieldErrors: unknown } } } };

export function parseBody<T>(schema: Schema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ message: "Invalid request body", errors: parsed.error.flatten().fieldErrors });
  }
  return parsed.data;
}

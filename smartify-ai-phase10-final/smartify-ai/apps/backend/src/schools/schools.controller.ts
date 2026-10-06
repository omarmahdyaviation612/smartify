import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { schoolSearchQuerySchema } from "@smartify/validation";
import { SchoolsService } from "./schools.service";

// Authenticated Smartify users only — school search is used from within
// onboarding (a signed-in-but-not-yet-onboarded student), never public.
@Controller("schools")
@UseGuards(ClerkAuthGuard)
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Get()
  search(@Query() query: unknown) {
    // zod validates+coerces the raw query string object — governorate must
    // be one of the 27 fixed codes (rejects anything else, so this can
    // never become an arbitrary-filter or injection surface), q/area are
    // bounded-length free text. No raw SQL is ever built from this input.
    const input = schoolSearchQuerySchema.parse(query);
    return this.schoolsService.search(input);
  }
}

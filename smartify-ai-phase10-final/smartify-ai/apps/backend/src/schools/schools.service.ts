import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SCHOOL_SEARCH_RESULT_LIMIT, SchoolSearchQuery } from "@smartify/validation";

@Injectable()
export class SchoolsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Searches ONLY Smartify's own School table — no external API call.
   * governorate is required (the frontend only enables school search after
   * a governorate is chosen); area and q are optional narrowing filters.
   * Case-insensitive on nameEn/nameAr via Prisma's `mode: "insensitive"`,
   * which Postgres executes as a parameterized ILIKE — no raw SQL, no
   * string concatenation, nothing user input can escape out of.
   */
  async search(query: SchoolSearchQuery) {
    const { governorate, area, q } = query;

    const schools = await this.prisma.client.school.findMany({
      where: {
        governorate,
        isActive: true,
        ...(area ? { area } : {}),
        ...(q
          ? {
              OR: [
                { nameEn: { contains: q, mode: "insensitive" } },
                { nameAr: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { nameEn: "asc" },
      take: SCHOOL_SEARCH_RESULT_LIMIT,
      select: { id: true, nameEn: true, nameAr: true, governorate: true, area: true },
    });

    return schools;
  }
}

import { Controller, Get, Param } from "@nestjs/common";
import { CurriculaService } from "./curricula.service";

// Public / unauthenticated — prospective students need to browse curricula before signing up.
@Controller("curricula")
export class CurriculaController {
  constructor(private readonly curriculaService: CurriculaService) {}

  @Get()
  getCatalog() {
    return this.curriculaService.getPublicCatalog();
  }

  @Get(":code/structure-sample")
  getStructureSample(@Param("code") code: string) {
    return this.curriculaService.getStructureSample(code);
  }
}

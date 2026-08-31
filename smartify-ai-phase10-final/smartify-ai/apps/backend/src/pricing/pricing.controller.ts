import { Controller, Get } from "@nestjs/common";
import { PricingService } from "./pricing.service";

// Deliberately public / unauthenticated — prospective students need to
// see pricing before signing up.
@Controller("pricing")
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  getPricing() {
    return this.pricingService.getPublicPricing();
  }
}

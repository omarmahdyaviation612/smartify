import { Module } from "@nestjs/common";
import { PaymentProviderFactory } from "./payment-provider.factory";

@Module({
  providers: [PaymentProviderFactory],
  exports: [PaymentProviderFactory],
})
export class PaymentsModule {}

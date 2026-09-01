import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import * as express from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadBackendEnv } from "@smartify/config";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";

async function bootstrap() {
  const env = loadBackendEnv(); // fails fast if required env vars are missing

  // bodyParser disabled globally so the Clerk/billing webhook routes can
  // register their own raw-body parsers — signature verification needs
  // the exact raw bytes, not JSON re-serialized by Nest's default parser.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(helmet()); // baseline security headers (CSP, HSTS, X-Frame-Options, etc.)
  app.use("/webhooks/clerk", express.raw({ type: "application/json" }));
  app.use("/webhooks/billing", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.enableCors({ origin: env.FRONTEND_URL, credentials: true });
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(env.PORT);
  console.log(`Smartify AI backend listening on port ${env.PORT}`);
}

bootstrap();

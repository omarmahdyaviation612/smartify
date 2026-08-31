import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/** Injects the local User row attached by ClerkAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

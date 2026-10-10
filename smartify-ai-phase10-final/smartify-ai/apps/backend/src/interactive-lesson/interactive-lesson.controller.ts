import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { InteractiveLessonService } from "./interactive-lesson.service";

@Controller("lesson")
@UseGuards(ClerkAuthGuard)
export class InteractiveLessonController {
  constructor(private readonly service: InteractiveLessonService) {}

  @Get("topics/:topicId/state")
  getState(@CurrentUser() user: any, @Param("topicId") topicId: string) {
    return this.service.getState(user.id, topicId);
  }

  /**
   * Streams a generated lesson visual's bytes. This is shared curriculum
   * content (generated once, reused by every student on this topic/step) —
   * not per-student private data — so the only gate is "authenticated at
   * all" (ClerkAuthGuard above), same as any other lesson content. Cached
   * aggressively client-side since the bytes never change once created.
   */
  @Get("visuals/:assetId")
  async getVisual(@Param("assetId") assetId: string, @Res() response: Response) {
    const asset = await this.service.getVisualAsset(assetId);
    response.set("Content-Type", asset.mimeType);
    response.set("Cache-Control", "public, max-age=31536000, immutable");
    response.send(asset.data);
  }

  /** Starts the lesson (first call) or moves forward once the current step is resolved. Never accepts a student-supplied position — the session alone decides. */
  @Post("topics/:topicId/advance")
  advance(@CurrentUser() user: any, @Param("topicId") topicId: string) {
    return this.service.advance(user.id, topicId);
  }

  /** Review mode: study a completed lesson again from the first step (keeps it marked completed). */
  @Post("topics/:topicId/restart")
  restart(@CurrentUser() user: any, @Param("topicId") topicId: string) {
    return this.service.restart(user.id, topicId);
  }

  /** A student message while a step is showing — either an answer to a pending check or an interruption question. */
  @Post("topics/:topicId/respond")
  respond(@CurrentUser() user: any, @Param("topicId") topicId: string, @Body() body: { message: string }) {
    return this.service.respond(user.id, topicId, body?.message);
  }
}

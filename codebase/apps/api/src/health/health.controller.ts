import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import { Public } from "../auth/decorators";
import { Errors } from "../common/errors";
import { ENV, type Env } from "../config/env";
import { Db } from "../db/db.service";
import { HealthDto, MinVersionsDto } from "../dto";

@ApiTags("platform")
@Public()
@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get("healthz")
  @ApiOperation({ summary: "Liveness: the process is up" })
  @ZodResponse({ status: 200, type: HealthDto })
  live() {
    return { status: "ok" as const, uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000) };
  }

  @Get("readyz")
  @ApiOperation({ summary: "Readiness: the database answers" })
  @ZodResponse({ status: 200, type: HealthDto })
  async ready() {
    try {
      await this.db.ping();
    } catch {
      throw Errors.unavailable("The database is not reachable.");
    }
    return this.live();
  }

  @Get("meta/min-versions")
  @ApiOperation({
    summary: "Oldest client versions still supported (older apps must show an upgrade screen)",
  })
  @ZodResponse({ status: 200, type: MinVersionsDto })
  minVersions() {
    return {
      web: this.env.MIN_VERSION_WEB,
      android: this.env.MIN_VERSION_ANDROID,
      ios: this.env.MIN_VERSION_IOS,
    };
  }
}

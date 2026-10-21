import { applyDecorators } from "@nestjs/common";
import { ApiBearerAuth, ApiDefaultResponse } from "@nestjs/swagger";
import { ProblemDto } from "./dto";

/** Documents the shared error body (RFC 7807) on a controller or route, and marks it as needing a bearer token. */
export const ApiAuthed = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiDefaultResponse({ description: "Error (application/problem+json)", type: ProblemDto }),
  );
export const ApiPublicRoute = () =>
  ApiDefaultResponse({ description: "Error (application/problem+json)", type: ProblemDto });

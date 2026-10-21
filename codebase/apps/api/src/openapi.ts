import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { z } from "zod";
import * as dtos from "./dto";

/**
 * Swagger only documents a path parameter when a handler declares it with @Param. Parameters that come from a
 * controller prefix (e.g. /merchant/orgs/:orgId/...) would be missing, and the generated client would not know
 * about them. Every `{name}` in a path must be a documented path parameter, so we add any that are missing.
 */
function addMissingPathParameters(doc: OpenAPIObject): void {
  for (const [path, item] of Object.entries(doc.paths)) {
    const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    for (const op of Object.values(item) as Array<
      { parameters?: Array<{ name: string; in: string }> } | undefined
    >) {
      if (!op || typeof op !== "object" || !("responses" in op)) continue;
      const known = new Set((op.parameters ?? []).filter((p) => p.in === "path").map((p) => p.name));
      for (const name of names) {
        if (known.has(name)) continue;
        op.parameters = op.parameters ?? [];
        op.parameters.push({
          name,
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        } as never);
      }
    }
  }
}

/**
 * nestjs-zod 5.5 loses the `null` branch of required nullable fields when it builds *response* schemas (they come out as
 * arrays). The Zod schema is the single source of truth, so every DTO schema in the contract is regenerated straight
 * from it with Zod's own JSON Schema converter. Request DTOs use the input side, response DTOs (`*_Output`) the output side.
 */
function regenerateDtoSchemas(doc: OpenAPIObject): void {
  const classes = new Map<string, { schema: z.ZodType }>(
    Object.entries(dtos)
      .filter(([, v]) => typeof v === "function" && (v as { isZodDto?: boolean }).isZodDto)
      .map(([name, v]) => [name, v as unknown as { schema: z.ZodType }]),
  );
  for (const name of Object.keys(doc.components?.schemas ?? {})) {
    const isOutput = name.endsWith("_Output");
    const cls = classes.get(isOutput ? name.slice(0, -"_Output".length) : name);
    if (!cls) continue;
    const { $schema: _ignored, ...json } = z.toJSONSchema(cls.schema, {
      io: isOutput ? "output" : "input",
      target: "draft-2020-12",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    doc.components!.schemas![name] = json as never;
  }
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Idea01 API")
    .setDescription(
      "Backend for the merchant and consumer apps. Errors are RFC 7807 problem details with a stable `code`.",
    )
    .setVersion("0.1.0")
    .setOpenAPIVersion("3.1.0") // 3.1 expresses nullable fields correctly (anyOf with null), which clients rely on
    .addBearerAuth()
    .build();
  const doc = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config), { version: "3.1" });
  regenerateDtoSchemas(doc);
  addMissingPathParameters(doc);
  return doc;
}

export function serveDocs(app: INestApplication, doc: OpenAPIObject): void {
  SwaggerModule.setup("docs", app, doc, { jsonDocumentUrl: "docs/openapi.json" });
}

/**
 * Convert a zod schema (or a plain object of zod schemas) into a JSON Schema
 * object suitable for the MCP `tools/list` response.
 *
 * `zod-to-json-schema` is the de-facto standard package for this, but to
 * avoid an extra dependency we ship a minimal converter that handles only
 * the constructs we actually use (z.string, z.number, z.boolean, z.enum,
 * z.object, .optional(), .min/.max, .describe()). If a more exotic schema
 * shows up, we fall back to `{}` (which MCP treats as "any").
 */
import { z } from "zod";

export type ZodShape = Record<string, z.ZodTypeAny>;

interface JsonSchema {
  type?: string;
  description?: string;
  enum?: string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  [k: string]: unknown;
}

export function zodToJsonSchema(shape: ZodShape): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, def] of Object.entries(shape)) {
    const { schema, isOptional } = unwrapOptional(def);
    properties[key] = zodDefToJsonSchema(schema);
    if (!isOptional) required.push(key);
  }

  const out: JsonSchema = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) out.required = required;
  return out;
}

function unwrapOptional(def: z.ZodTypeAny): {
  schema: z.ZodTypeAny;
  isOptional: boolean;
} {
  if (def instanceof z.ZodOptional) {
    return { schema: (def as any)._def.innerType, isOptional: true };
  }
  // Zod 3.23+ uses ZodOptional as a class; older used .isOptional() flag.
  if (typeof (def as any).isOptional === "function" && (def as any).isOptional()) {
    // Best-effort: if there's an innerType, unwrap.
    const inner = (def as any)._def?.innerType;
    if (inner) return { schema: inner, isOptional: true };
  }
  return { schema: def, isOptional: false };
}

function zodDefToJsonSchema(def: z.ZodTypeAny): JsonSchema {
  // Pull description first so it survives type narrowing.
  const description = (def as any).description as string | undefined;

  if (def instanceof z.ZodString) {
    const out: JsonSchema = { type: "string", description };
    const checks = (def as any)._def?.checks as Array<{ kind: string; value?: number; message?: string }> | undefined;
    if (checks) {
      for (const c of checks) {
        if (c.kind === "min") out.minLength = c.value;
        if (c.kind === "max") out.maxLength = c.value;
      }
    }
    return stripEmpty(out);
  }
  if (def instanceof z.ZodNumber) {
    const out: JsonSchema = { type: "number", description };
    const checks = (def as any)._def?.checks as Array<{ kind: string; value?: number }> | undefined;
    if (checks) {
      for (const c of checks) {
        if (c.kind === "min") out.minimum = c.value;
        if (c.kind === "max") out.maximum = c.value;
      }
    }
    return stripEmpty(out);
  }
  if (def instanceof z.ZodBoolean) {
    return stripEmpty({ type: "boolean", description });
  }
  if (def instanceof z.ZodEnum) {
    const options = (def as any)._def?.values as string[] | undefined;
    return stripEmpty({ type: "string", enum: options ?? [], description });
  }
  if (def instanceof z.ZodArray) {
    const inner = (def as any)._def?.type as z.ZodTypeAny | undefined;
    return stripEmpty({
      type: "array",
      items: inner ? zodDefToJsonSchema(inner) : {},
      description,
    });
  }
  if (def instanceof z.ZodObject) {
    const shape = (def as any)._def?.shape() as ZodShape | undefined;
    return stripEmpty({ ...zodToJsonSchema(shape ?? {}), description });
  }
  // Unknown type — MCP accepts `{}` as "any".
  return stripEmpty({ description });
}

function stripEmpty(out: JsonSchema): JsonSchema {
  for (const k of Object.keys(out)) {
    if (out[k] === undefined || out[k] === null) delete out[k];
  }
  return out;
}

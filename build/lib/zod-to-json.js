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
export function zodToJsonSchema(shape) {
    const properties = {};
    const required = [];
    for (const [key, def] of Object.entries(shape)) {
        const { schema, isOptional } = unwrapOptional(def);
        properties[key] = zodDefToJsonSchema(schema);
        if (!isOptional)
            required.push(key);
    }
    const out = {
        type: "object",
        properties,
        additionalProperties: false,
    };
    if (required.length > 0)
        out.required = required;
    return out;
}
function unwrapOptional(def) {
    if (def instanceof z.ZodOptional) {
        return { schema: def._def.innerType, isOptional: true };
    }
    // Zod 3.23+ uses ZodOptional as a class; older used .isOptional() flag.
    if (typeof def.isOptional === "function" && def.isOptional()) {
        // Best-effort: if there's an innerType, unwrap.
        const inner = def._def?.innerType;
        if (inner)
            return { schema: inner, isOptional: true };
    }
    return { schema: def, isOptional: false };
}
function zodDefToJsonSchema(def) {
    // Pull description first so it survives type narrowing.
    const description = def.description;
    if (def instanceof z.ZodString) {
        const out = { type: "string", description };
        const checks = def._def?.checks;
        if (checks) {
            for (const c of checks) {
                if (c.kind === "min")
                    out.minLength = c.value;
                if (c.kind === "max")
                    out.maxLength = c.value;
            }
        }
        return stripEmpty(out);
    }
    if (def instanceof z.ZodNumber) {
        const out = { type: "number", description };
        const checks = def._def?.checks;
        if (checks) {
            for (const c of checks) {
                if (c.kind === "min")
                    out.minimum = c.value;
                if (c.kind === "max")
                    out.maximum = c.value;
            }
        }
        return stripEmpty(out);
    }
    if (def instanceof z.ZodBoolean) {
        return stripEmpty({ type: "boolean", description });
    }
    if (def instanceof z.ZodEnum) {
        const options = def._def?.values;
        return stripEmpty({ type: "string", enum: options ?? [], description });
    }
    if (def instanceof z.ZodArray) {
        const inner = def._def?.type;
        return stripEmpty({
            type: "array",
            items: inner ? zodDefToJsonSchema(inner) : {},
            description,
        });
    }
    if (def instanceof z.ZodObject) {
        const shape = def._def?.shape();
        return stripEmpty({ ...zodToJsonSchema(shape ?? {}), description });
    }
    // Unknown type — MCP accepts `{}` as "any".
    return stripEmpty({ description });
}
function stripEmpty(out) {
    for (const k of Object.keys(out)) {
        if (out[k] === undefined || out[k] === null)
            delete out[k];
    }
    return out;
}

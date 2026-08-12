import { FormatRegistry, type Static, type TSchema, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { fullFormats } from 'ajv-formats/dist/formats.js';


if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set('date-time', isRfc3339DateTime);
}

export const nonEmptyStringSchema = Type.String({ minLength: 1 });
export const isoTimestampSchema = Type.String({ format: 'date-time' });
export const canonicalUtcTimestampSchema = Type.String({
    format: 'date-time',
    pattern: 'Z$',
});

export function isSchema<TSchemaType extends TSchema>(
    schema: TSchemaType,
    value: unknown,
): value is Static<TSchemaType> {
    return Value.Check(schema, value);
}

export function normalizeIsoTimestamp(value: unknown): string | undefined {
    if (typeof value !== 'string' || !isSchema(isoTimestampSchema, value)) {
        return undefined;
    }

    return new Date(value).toISOString().replace('.000Z', 'Z');
}

function isRfc3339DateTime(value: string): boolean {
    const format = fullFormats['date-time'];
    const validator =
        typeof format === 'object' && format !== null && 'validate' in format
            ? (format.validate as (candidate: string) => boolean)
            : undefined;

    return typeof validator === 'function' && validator(value) === true;
}

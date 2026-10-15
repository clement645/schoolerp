import type { TypedSchema, TypedSchemaError } from 'vee-validate';
import type { z } from 'zod';

/**
 * Adapts a Zod schema for VeeValidate's `validationSchema`. (The official
 * adapter targets Zod 3; this covers the same contract for Zod 4.)
 */
export function zodForm<T extends z.ZodType>(schema: T): TypedSchema<z.input<T>, z.output<T>> {
  return {
    __type: 'VVTypedSchema',
    async parse(values) {
      const result = await schema.safeParseAsync(values);
      if (result.success) {
        return { value: result.data, errors: [] };
      }

      const byPath = new Map<string, string[]>();
      for (const issue of result.error.issues) {
        const path = issue.path.map(String).join('.');
        byPath.set(path, [...(byPath.get(path) ?? []), issue.message]);
      }
      const errors: TypedSchemaError[] = [...byPath].map(([path, messages]) => ({
        path,
        errors: messages,
      }));
      return { errors };
    },
  };
}

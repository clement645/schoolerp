import { z } from 'zod';

const responseMetaSchema = z.object({
  requestId: z.string().nullable(),
  timestamp: z.string(),
});

/**
 * Success envelope returned by every API endpoint. `data` is validated
 * separately against the schema of the resource being requested.
 */
export const successEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
  meta: responseMetaSchema,
});

/** Error envelope returned by every API endpoint. */
export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  meta: responseMetaSchema.extend({ path: z.string() }),
});

export type ApiErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** A page of results, as returned by every list endpoint. */
export const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  });

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

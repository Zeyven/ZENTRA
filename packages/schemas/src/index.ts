import { z } from 'zod';
export const livenessSchema = z.object({ status: z.literal('ok'), service: z.literal('ayra-api') });
export type Liveness = z.infer<typeof livenessSchema>;

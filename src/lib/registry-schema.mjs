import { z } from 'zod';

export const CommitterSchema = z.object({
  login: z.string().nullable(),
  name: z.string(),
  avatar_url: z.string().nullable(),
  date: z.string().nullish(),
});

export const SkillSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  plugin: z.string().min(1),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'repo must be org/name format'),
  path: z.string().min(1),
  author: z.string(),
  committer: CommitterSchema.nullish(),
  version: z.string(),
  compatibility: z.array(z.string()),
  sensitive_data: z.boolean(),
  type: z.enum(['skill', 'agent']),
  content: z.string(),
  last_updated: z.string().nullable(),
  // agent-only optional fields
  tools_used: z.array(z.string()).optional(),
  human_in_loop: z.string().optional(),
});

export const PluginSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'repo must be org/name format'),
  author: z.string(),
  skill_count: z.number().int().nonnegative(),
  agent_count: z.number().int().nonnegative(),
  skills: z.array(z.string()),
  agents: z.array(z.string()),
});

export const RegistrySchema = z.object({
  generated_at: z.string(),
  org: z.string().min(1),
  plugins: z.array(PluginSchema),
  skills: z.array(SkillSchema),
});

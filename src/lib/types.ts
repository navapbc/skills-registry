/**
 * Client-side shapes for the JSON the API returns.
 *
 * These are deliberately loose: `fetchApi` returns `any`, and the registry
 * payload carries fields the browser never reads. The index signature keeps
 * that extra data addressable without forcing every field to be declared.
 */

export interface Skill {
  slug: string;
  name: string;
  description: string;
  plugin: string;
  type: 'skill' | 'agent';
  /** 'enterprise' for org-wide skills; absent or other values for community ones. */
  source?: string;
  tags?: string[];
  compatibility?: string[];
  last_updated?: string | null;
  [key: string]: unknown;
}

/** A skill recorded in localStorage after its install command was copied. */
export interface InstalledSkill extends Skill {
  installedAt: number;
  installCommand?: string;
}

export interface Plugin {
  slug: string;
  name: string;
  description?: string;
  skills_count?: number;
  agents_count?: number;
  [key: string]: unknown;
}

/** An entry in the homepage search index. */
export interface SearchItem {
  type: 'plugin' | 'skill' | 'agent';
  name: string;
  description: string;
  url: string;
  meta: string;
  keywords: string;
}

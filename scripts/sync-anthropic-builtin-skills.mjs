import { ddb, tables, PutCommand } from '../functions/api/lib/dynamo.mjs';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
const env = envFlag !== -1 ? args[envFlag + 1] : null;

if (!env || !['staging', 'prod'].includes(env)) {
  console.error('Usage: node scripts/sync-anthropic-builtin-skills.mjs --env staging|prod');
  process.exit(1);
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

process.env.SKILLS_TABLE = `skills-registry-skills-${env}`;

const DESCRIPTIONS = {
  xlsx: 'Read and write Excel spreadsheets via Claude code execution in the Anthropic Messages API.',
  pptx: 'Generate and modify PowerPoint presentations via Claude code execution in the Anthropic Messages API.',
  pdf:  'Extract and process PDF content via Claude code execution in the Anthropic Messages API.',
  docx: 'Read and write Word documents via Claude code execution in the Anthropic Messages API.',
};

async function fetchAnthropicSkills() {
  const res = await fetch('https://api.anthropic.com/v1/skills?source=anthropic', {
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'skills-2025-10-02',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.data ?? [];
}

async function upsertSkill(skill) {
  const now = new Date().toISOString();
  const item = {
    slug: skill.id,
    name: skill.display_title,
    description: DESCRIPTIONS[skill.id] ?? skill.display_title,
    source: 'anthropic-builtin',
    type: 'tool',
    status: 'approved',
    visibility: 'public',
    version: skill.latest_version,
    tags: [],
    plugin: 'anthropic',
    repo: 'anthropic',
    path: '',
    author: 'Anthropic',
    compatibility: [],
    last_updated: skill.updated_at,
    updated_at: now,
    created_at: skill.created_at,
  };

  await ddb.send(new PutCommand({
    TableName: tables.skills(),
    Item: item,
    ConditionExpression: 'attribute_not_exists(#slug) OR #src = :builtin',
    ExpressionAttributeNames: { '#slug': 'slug', '#src': 'source' },
    ExpressionAttributeValues: { ':builtin': 'anthropic-builtin' },
  }));

  console.log(`  ✓ upserted: ${skill.id} (v${skill.latest_version})`);
}

async function main() {
  console.log(`Syncing Anthropic built-in skills → ${tables.skills()}`);
  const skills = await fetchAnthropicSkills();
  console.log(`Found ${skills.length} Anthropic skills`);

  for (const skill of skills) {
    try {
      await upsertSkill(skill);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`  ↷ skipped: ${skill.id} (non-builtin record exists — slug collision)`);
      } else {
        throw err;
      }
    }
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });

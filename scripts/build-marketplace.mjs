#!/usr/bin/env node
// Builds .claude-plugin/marketplace.json from all plugin repositories listed in
// sources.json (topic discovery + explicit includes) and refreshes the plugin
// table in README.md. Output is deterministic, so the pipeline only commits
// when a plugin was actually added, removed or changed.
//
// Usage: GITHUB_TOKEN=... node scripts/build-marketplace.mjs [--check]
//   --check  exit 1 if the generated files differ from the committed ones

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKETPLACE_FILE = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const README_FILE = path.join(ROOT, 'README.md');
const CHECK = process.argv.includes('--check');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const MARKETPLACE_META = {
  $schema: 'https://json.schemastore.org/claude-code-marketplace.json',
  name: 'jtracht-plugins',
  description: 'All Claude Code plugins by Julian Tracht, collected automatically from their source repositories.',
  owner: { name: 'Julian Tracht', url: 'https://github.com/jtracht' },
};

async function gh(apiPath) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jtracht-plugins-builder',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${apiPath}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function ghJsonFile(repo, filePath, ref) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const file = await gh(`/repos/${repo}/contents/${filePath}${query}`);
  if (!file || file.type !== 'file') return null;
  const text = Buffer.from(file.content, 'base64').toString('utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${repo}/${filePath}: invalid JSON (${err.message})`);
  }
}

async function discoverRepos(sources) {
  const repos = new Map();
  for (let page = 1; ; page++) {
    const batch = await gh(`/users/${sources.owner}/repos?type=owner&per_page=100&page=${page}`);
    if (!batch?.length) break;
    for (const r of batch) {
      if (r.private || r.archived || r.fork) continue;
      if (!r.topics?.includes(sources.topic)) continue;
      repos.set(r.full_name.toLowerCase(), { repo: r.full_name });
    }
    if (batch.length < 100) break;
  }
  for (const inc of sources.include ?? []) {
    const entry = typeof inc === 'string' ? { repo: inc } : inc;
    repos.set(entry.repo.toLowerCase(), entry);
  }
  for (const exc of sources.exclude ?? []) repos.delete(exc.toLowerCase());
  return [...repos.values()].sort((a, b) => a.repo.localeCompare(b.repo));
}

// Relative sources only make sense inside their own repo; rewrite them so they
// resolve from this marketplace.
function absolutizeSource(source, repo, ref) {
  if (typeof source !== 'string') return source;
  const rel = source.replace(/^\.\/?/, '').replace(/\/$/, '');
  if (!rel) return { source: 'github', repo, ...(ref ? { ref } : {}) };
  return { source: 'git-subdir', url: `https://github.com/${repo}.git`, path: rel, ...(ref ? { ref } : {}) };
}

async function pluginsFromRepo({ repo, ref }) {
  const marketplace = await ghJsonFile(repo, '.claude-plugin/marketplace.json', ref);
  if (marketplace?.plugins?.length) {
    return marketplace.plugins.map((p) => ({ ...p, source: absolutizeSource(p.source, repo, ref) }));
  }
  const manifest = await ghJsonFile(repo, '.claude-plugin/plugin.json', ref);
  if (manifest?.name) {
    return [
      {
        name: manifest.name,
        ...(manifest.displayName ? { displayName: manifest.displayName } : {}),
        description: manifest.description ?? '',
        ...(manifest.keywords ? { tags: manifest.keywords } : {}),
        source: absolutizeSource('./', repo, ref),
      },
    ];
  }
  console.warn(`! ${repo}: neither .claude-plugin/marketplace.json nor .claude-plugin/plugin.json found, skipped`);
  return [];
}

function sourceUrl(source) {
  if (source.source === 'github') return `https://github.com/${source.repo}`;
  if (source.url) return source.url.replace(/\.git$/, '') + (source.path ? `/tree/${source.ref ?? 'HEAD'}/${source.path}` : '');
  return '';
}

function renderTable(plugins) {
  if (!plugins.length) return '_Noch keine Plugins gefunden._';
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const rows = plugins.map(
    (p) =>
      `| [\`${p.name}\`](${sourceUrl(p.source)}) | ${esc(p.description)} | \`/plugin install ${p.name}@${MARKETPLACE_META.name}\` |`,
  );
  return ['| Plugin | Beschreibung | Installation |', '| --- | --- | --- |', ...rows].join('\n');
}

async function writeIfChanged(file, content) {
  const current = await readFile(file, 'utf8').catch(() => null);
  if (current === content) return false;
  if (CHECK) {
    console.error(`✗ ${path.relative(ROOT, file)} is out of date`);
    return true;
  }
  await writeFile(file, content);
  console.log(`✓ updated ${path.relative(ROOT, file)}`);
  return true;
}

const sources = JSON.parse(await readFile(path.join(ROOT, 'sources.json'), 'utf8'));
const repos = await discoverRepos(sources);
console.log(`Found ${repos.length} plugin repo(s): ${repos.map((r) => r.repo).join(', ') || '-'}`);

const byName = new Map();
for (const entry of repos) {
  for (const plugin of await pluginsFromRepo(entry)) {
    if (byName.has(plugin.name)) {
      throw new Error(`Duplicate plugin name "${plugin.name}" (${byName.get(plugin.name).origin} and ${entry.repo})`);
    }
    byName.set(plugin.name, { plugin, origin: entry.repo });
    console.log(`  + ${plugin.name} (${entry.repo})`);
  }
}
const plugins = [...byName.values()].map((v) => v.plugin).sort((a, b) => a.name.localeCompare(b.name));

let changed = await writeIfChanged(
  MARKETPLACE_FILE,
  JSON.stringify({ ...MARKETPLACE_META, plugins }, null, 2) + '\n',
);

const readme = await readFile(README_FILE, 'utf8');
const updatedReadme = readme.replace(
  /(<!-- plugins:start -->)[\s\S]*?(<!-- plugins:end -->)/,
  `$1\n${renderTable(plugins)}\n$2`,
);
changed = (await writeIfChanged(README_FILE, updatedReadme)) || changed;

if (CHECK && changed) process.exit(1);
if (!changed) console.log('Marketplace is up to date.');

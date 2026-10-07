import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('release metadata aligns the 0.8.1 UI patch and every consumer', () => {
  const root = json(new URL('../package.json', import.meta.url));
  const lock = json(new URL('../package-lock.json', import.meta.url));
  const pi = json(new URL('../adapters/pi/package.json', import.meta.url));
  const core = json(new URL('../packages/nmnm-core/package.json', import.meta.url));
  const cli = json(new URL('../packages/nmnm-cli/package.json', import.meta.url));
  const ui = json(new URL('../packages/nmnm-ui/package.json', import.meta.url));
  const claude = json(new URL('../adapters/claude/package.json', import.meta.url));
  const codex = json(new URL('../adapters/codex/package.json', import.meta.url));
  const opencode = json(new URL('../adapters/opencode/package.json', import.meta.url));
  assert.equal(root.version, '0.8.1');
  assert.equal(lock.version, root.version);
  assert.equal(lock.packages['adapters/codex'].name, '@openlines/nmnm-codex');
  assert.equal(lock.packages['node_modules/@openlines/nmnm-codex'].resolved, 'adapters/codex');
  assert.equal(core.version, '0.3.1');
  assert.equal(core.exports['./logging'], './src/logslines.js');
  assert(core.files.includes('src/logslines.js'));
  assert(!core.files.includes('src/logging.js'));
  assert.equal(cli.version, '0.4.1');
  assert.equal(ui.name, '@openlines/nmnm-ui');
  assert.equal(ui.version, '0.1.1');
  assert.notEqual(ui.private, true);
  assert.equal(cli.dependencies['@openlines/nmnm-ui'], ui.version);
  assert.equal(cli.engines.node, ui.engines.node);
  assert.equal(ui.exports, './src/launcher.js');
  assert.equal(ui.engines.node, root.engines.node);
  assert.equal(lock.packages['node_modules/@openlines/nmnm-ui'].resolved, 'packages/nmnm-ui');
  assert.equal(pi.version, '0.4.2');
  assert.equal(claude.name, '@openlines/nmnm-claude');
  assert.equal(claude.version, '0.2.2');
  assert.equal(claude.dependencies['@modelcontextprotocol/sdk'], '^1.31.0');
  assert.equal(lock.packages['adapters/claude'].dependencies['@modelcontextprotocol/sdk'], claude.dependencies['@modelcontextprotocol/sdk']);
  const [sdkMajor, sdkMinor] = lock.packages['node_modules/@modelcontextprotocol/sdk'].version.split('.').map(Number);
  assert.ok(sdkMajor > 1 || (sdkMajor === 1 && sdkMinor >= 31), 'MCP SDK must include the OAuth advisory fix');
  assert.equal(codex.version, '0.2.2');
  assert.equal(opencode.version, '0.2.2');
  for (const [path, pkg] of [['', root], ['packages/nmnm-core', core], ['packages/nmnm-cli', cli], ['packages/nmnm-ui', ui],
    ['adapters/pi', pi], ['adapters/claude', claude], ['adapters/codex', codex], ['adapters/opencode', opencode]]) {
    assert.equal(lock.packages[path].version, pkg.version, `${path || 'root'} lockfile version`);
    assert.deepEqual(lock.packages[path].engines, pkg.engines, `${path || 'root'} lockfile engines`);
  }
  for (const pkg of [cli, ui, pi, codex, opencode]) {
    assert.equal(pkg.dependencies['@openlines/nmnm-core'], core.version, `${pkg.name} must pin the current core`);
  }
  for (const path of ['packages/nmnm-cli', 'packages/nmnm-ui', 'adapters/pi', 'adapters/codex', 'adapters/opencode']) {
    assert.equal(lock.packages[path].dependencies['@openlines/nmnm-core'], core.version, `${path} lockfile core pin`);
  }
  assert.equal(claude.dependencies['@openlines/nmnm-core'], '^0.3.0');
  assert.equal(lock.packages['adapters/claude'].dependencies['@openlines/nmnm-core'], claude.dependencies['@openlines/nmnm-core']);
  assert.equal(json(new URL('../adapters/claude/.claude-plugin/plugin.json', import.meta.url)).version, claude.version);
  assert.equal(json(new URL('../adapters/codex/.codex-plugin/plugin.json', import.meta.url)).version, codex.version);
  assert.equal(root.engines.node, '>=22.19.0');
  assert.equal(pi.engines.node, '>=22.19.0');
  assert.equal(root.devDependencies['@earendil-works/pi-coding-agent'], '>=0.87.0');
  assert.equal(lock.packages['node_modules/@earendil-works/pi-coding-agent'].version, '1.0.4');
  assert.deepEqual(pi.peerDependencies, {
    '@earendil-works/pi-tui': '*',
    typebox: '*',
  });
  assert.equal(root.devDependencies['@openlines/logslines'], undefined);
  assert.equal(lock.packages['../logslines'], undefined);
  assert.equal(root.devDependencies.esbuild, '0.28.2');
  assert.equal(pi.dependencies['@openlines/logslines'], undefined);
  assert.equal(pi.dependencies['@openlines/nmnm-logger'], undefined);
  assert.equal(lock.packages['packages/logger'], undefined);
});

test('Codex prototype remains marketplace-local and is not released to npm', () => {
  const codex = json(new URL('../adapters/codex/package.json', import.meta.url));
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  assert.equal(codex.private, true);
  assert.equal(codex.publishConfig, undefined);
  assert.match(ci, /npm run validate/);
  assert.doesNotMatch(release, /@openlines\/nmnm-codex/);
  assert.doesNotMatch(readme, /npmjs\.com\/package\/%40openlines%2Fnmnm-codex/);
});

test('OpenCode declares its tested host floor while the lock retains a compatible resolved version', () => {
  const opencode = json(new URL('../adapters/opencode/package.json', import.meta.url));
  const lock = json(new URL('../package-lock.json', import.meta.url));
  const dependency = opencode.dependencies['@opencode-ai/plugin'];
  assert.equal(dependency, '>=1.18.15');
  assert.equal(lock.packages['adapters/opencode'].dependencies['@opencode-ai/plugin'], dependency);
  const [major, minor, patch] = lock.packages['node_modules/@opencode-ai/plugin'].version.split('.').map(Number);
  assert.ok(major > 1 || (major === 1 && (minor > 18 || (minor === 18 && patch >= 15))));
});

test('tag publishing requires the same blocking rendered UI job as branch CI', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const ciUi = ci.split('\n  ui:')[1].trim();
  const releaseUi = release.split('\n  ui:')[1]?.split('\n  publish:')[0].trim();
  assert.equal(releaseUi, ciUi);
  const publish = release.split('\n  publish:')[1];
  assert.match(publish, /needs: \[validate, ui\]/);
  assert.doesNotMatch(publish, /if:.*always\(\)/);
  assert.doesNotMatch(releaseUi, /continue-on-error/);
  assert.match(releaseUi, /image: mcr\.microsoft\.com\/playwright\/python:v1\.62\.0-noble/);
  assert.match(releaseUi, /options: --init --ipc=host/);
  assert.match(releaseUi, /PLAYWRIGHT_BROWSERS_PATH: \/ms-playwright/);
  assert.match(releaseUi, /python -m pip install playwright==1\.62\.0/);
  assert.match(releaseUi, /python -m playwright install --only-shell chromium/);
  assert.doesNotMatch(releaseUi, /--with-deps|apt-get|matrix:/);
  assert.match(releaseUi, /name: Run all browser workflow and accessibility checks\n        timeout-minutes: 6\n        env:\n          HOME: \/root\n        run: bash scripts\/run-ui-browser-checks\.sh/);
  assert.match(releaseUi, /timeout-minutes: 15/);
  assert.match(releaseUi, /retention-days: 7/);
});

test('CI and release use read-only validation while retaining informational audit and publish order', () => {
  for (const name of ['ci', 'release']) {
    const workflow = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    const validation = workflow.split('\n  publish:')[0];
    assert.equal((validation.match(/run: npm run validate/g) ?? []).length, 1);
    assert.match(validation, /run: npm audit --audit-level=high\n\s+continue-on-error: true/);
    assert.doesNotMatch(validation, /run: npm test|run: node scripts\/check-logging-packages|logslines:build|logslines:update|codex:update|--prepare-codex/);
    assert.match(validation, /run: git diff --check/);
    assert.match(validation, /npm pack --dry-run/);
  }
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const publish = ['core', 'UI', 'CLI', 'Pi adapter', 'OpenCode adapter'].map(name => release.indexOf(`name: Publish ${name} when this version is new`));
  assert.ok(publish.every((position, index) => position >= 0 && (!index || position > publish[index - 1])));
  assert.match(release, /Verify release tag/);
});

test('release validates changelog before publishing and forwards the extracted notes', () => {
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const [validation, publish] = release.split('\n  publish:');
  assert.match(validation, /notes: \$\{\{ steps\.changelog\.outputs\.notes \}\}/);
  assert.match(publish, /needs: \[validate, ui\]/);
  assert.match(publish, /body: \$\{\{ needs\.validate\.outputs\.notes \}\}/);
  assert.doesNotMatch(publish, /Extract changelog/);
  const script = validation.match(/id: changelog\n        run: \|\n([\s\S]*?)(?=      #)/)[1]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const directory = mkdtempSync(join(tmpdir(), 'nmnm-release-notes-'));
  const output = join(directory, 'output');
  try {
    const env = { ...process.env, GITHUB_REF_NAME: 'v0.8.0', GITHUB_OUTPUT: output };
    writeFileSync(join(directory, 'CHANGELOG.md'), '# Changelog\n\n## 0.8.0 - Workbench\n\n### New\n\n- UI workbench.\n\n## 0.7.0\n\n- Older change.\n');
    const extracted = spawnSync('bash', ['-e', '-c', script], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    const notes = readFileSync(output, 'utf8');
    assert.match(notes, /### New\n\n- UI workbench\./);
    assert.doesNotMatch(notes, /Older change/);
    rmSync(output);
    for (const changelog of ['## 0.7.0\n\n- Older change.\n', '## 0.8.0\n\n## 0.7.0\n- Older change.\n']) {
      writeFileSync(join(directory, 'CHANGELOG.md'), changelog);
      const rejected = spawnSync('bash', ['-e', '-c', script], { cwd: directory, env, encoding: 'utf8' });
      assert.notEqual(rejected.status, 0);
      assert.throws(() => readFileSync(output));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

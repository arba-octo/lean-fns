import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cpus, platform, arch, release, totalmem } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const { values } = parseArgs({ options: {
  verify: { type: 'boolean' }, worker: { type: 'string' }, output: { type: 'string' },
  rounds: { type: 'string', default: '3' }, time: { type: 'string', default: '500' },
  warmup: { type: 'string', default: '200' }, seed: { type: 'string', default: '1729' },
} });
function integer(name, min, max) {
  const n = Number(values[name]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  return n;
}
const settings = {
  rounds: integer('rounds', 1, 20), timeMs: integer('time', 10, 10000),
  warmupMs: integer('warmup', 10, 10000), seed: integer('seed', 1, 2147483647),
  batchSize: 32, poolSize: 16, minSamples: 64, input: 'pre-frozen', nodeEnv: 'production',
};

// Import competitors only after selecting production mode, including in verification.
process.env.NODE_ENV = 'production';
const { scenarios, implementations, deepFreeze, readAt, verifyAll, verifyCase } = await import('./update-in-cases.mjs');

if (values.verify) {
  console.log(`Benchmark correctness: ${verifyAll()} checks passed (7 scenarios x 6 implementations x 2 seeds).`);
} else if (values.worker) {
  const { scenario: scenarioId, implementation: implementationId, round } = JSON.parse(values.worker);
  const scenario = scenarios.find(item => item.id === scenarioId);
  const implementation = implementations.find(item => item.id === implementationId);
  assert.ok(scenario && implementation, 'unknown benchmark case');
  verifyCase(scenario, implementation);
  const { Bench } = await import('tinybench');
  const pool = Array.from({ length: settings.poolSize }, (_, seed) => deepFreeze(scenario.create(seed)));
  const operation = implementation.prepare(scenario);
  let sink;
  let cursor = 0;
  const bench = new Bench({
    time: settings.timeMs, warmupTime: settings.warmupMs, iterations: settings.minSamples,
    warmupIterations: settings.minSamples, retainSamples: false, throws: true,
  });
  const warnings = [];
  bench.addEventListener('warning', event => warnings.push(event.reason));
  bench.add('update', () => {
    for (let i = 0; i < settings.batchSize; i++) {
      sink = operation(pool[cursor++ % settings.poolSize]);
    }
  });
  const [task] = bench.runSync();
  assert.equal(task.result.state, 'completed');
  // Consume the escaping result outside timing; verification checks every implementation first.
  const input = pool[(cursor - 1) % settings.poolSize];
  assert.deepEqual(readAt(sink, scenario.path), scenario.updater(readAt(input, scenario.path)));
  const latency = task.result.latency;
  const nsPerOp = latency.mean * 1e6 / settings.batchSize;
  assert.ok(Number.isFinite(nsPerOp) && nsPerOp > 0);
  console.log(JSON.stringify({
    scenario: scenarioId, implementation: implementationId, round,
    nsPerOp, opsPerSecond: 1e9 / nsPerOp, samples: task.runs, rmePercent: latency.rme,
    warnings: [...new Set(warnings)],
  }));
} else {
  const output = values.output && resolve(values.output);
  if (output && existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
  const verifiedChecks = verifyAll();
  const version = name => {
    let directory = dirname(require.resolve(name));
    while (true) {
      const file = join(directory, 'package.json');
      if (existsSync(file)) {
        const pkg = JSON.parse(readFileSync(file, 'utf8'));
        if (pkg.name === name) return pkg.version;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`Cannot identify ${name} version`);
      directory = parent;
    }
  };
  const fingerprintPaths = ['package.json', 'pnpm-lock.yaml', 'tsdown.config.ts', 'src/update-in.ts',
    'dist/index.js', 'benchmarks/update-in.mjs', 'benchmarks/update-in-cases.mjs'];
  const fingerprints = () => Object.fromEntries(fingerprintPaths.map(path => [path,
    createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
  const before = fingerprints();
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const metadata = {
    startedAt: new Date().toISOString(), node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, totalMemoryBytes: totalmem(), execArgv: process.execArgv,
    nodeOptions: process.env.NODE_OPTIONS ?? '', packageManager: process.env.npm_config_user_agent ?? null,
    versions: Object.fromEntries(['immer', 'lodash', 'es-toolkit', 'tinybench'].map(name => [name, version(name)])),
    git: { branch: git('branch', '--show-current'), head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 },
    hashes: before, settings, verifiedChecks,
  };
  let randomState = settings.seed;
  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
      const j = randomState % (i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  const jobs = [];
  for (let round = 1; round <= settings.rounds; round++) {
    jobs.push(...shuffle(scenarios.flatMap(scenario => implementations.map(implementation => ({
      scenario: scenario.id, implementation: implementation.id, round,
    })))));
  }
  console.log(`Verified ${verifiedChecks} checks. ${jobs.length} sequential isolated processes; NODE_ENV=production.`);
  const results = [];
  for (const job of jobs) {
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, script, '--worker', JSON.stringify(job),
        '--time', String(settings.timeMs), '--warmup', String(settings.warmupMs)], {
        cwd: root, env: { ...process.env, NODE_ENV: 'production' }, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) return reject(new Error(`Worker failed (${code}): ${stderr}`));
        try { resolveResult(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    });
    results.push(result);
    console.log(`[${results.length}/${jobs.length}] r${job.round} ${job.scenario} / ${job.implementation}: ${result.nsPerOp.toFixed(1)} ns/op`);
    if (result.warnings.length) {
      console.warn(`Timing warning: r${job.round} ${job.scenario} / ${job.implementation}: ${result.warnings.join(', ')}`);
    }
  }
  assert.deepEqual(fingerprints(), before, 'benchmark sources/build changed during measurement; discard this run');
  const median = numbers => {
    const sorted = numbers.toSorted((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const summary = scenarios.flatMap(scenario => implementations.map(implementation => {
    const runs = results.filter(row => row.scenario === scenario.id && row.implementation === implementation.id);
    const latencies = runs.map(row => row.nsPerOp);
    const nsPerOp = median(latencies);
    return { scenario: scenario.id, implementation: implementation.id, medianNsPerOp: nsPerOp,
      opsPerSecond: 1e9 / nsPerOp, minNsPerOp: Math.min(...latencies), maxNsPerOp: Math.max(...latencies),
      maxRmePercent: Math.max(...runs.map(row => row.rmePercent)),
      warnings: [...new Set(runs.flatMap(row => row.warnings))],
      noopReturnsInput: Boolean(scenario.noop && implementation.noopIdentity) };
  }));
  console.table(summary.map(row => ({ scenario: row.scenario, implementation: row.implementation,
    'median ns/op': row.medianNsPerOp.toFixed(1), 'min..max': `${row.minNsPerOp.toFixed(1)}..${row.maxNsPerOp.toFixed(1)}`,
    'max RME %': row.maxRmePercent.toFixed(2), warnings: row.warnings.join(', ') })));
  const report = { metadata, completedAt: new Date().toISOString(), results, summary };
  if (output) {
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(`JSON: ${output}`);
  }
}

import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, platform, arch, release, tmpdir } from 'node:os';
import { dirname, resolve, relative, isAbsolute, sep, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildModules, hash, packageVersion } from './produce-build.mjs';
import { scenarios, execute, verifyAll, verifyCase } from './produce-cases.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const { values } = parseArgs({ options: {
  verify: { type: 'boolean' }, worker: { type: 'string' }, output: { type: 'string' }, baseline: { type: 'string' },
  scenario: { type: 'string' },
  rounds: { type: 'string', default: '3' }, time: { type: 'string', default: '500' },
  warmup: { type: 'string', default: '200' }, seed: { type: 'string', default: '1729' },
} });
function integer(name, min, max) {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be ${min}..${max}`);
  return value;
}
const settings = { rounds: integer('rounds', 1, 20), timeMs: integer('time', 10, 10000),
  warmupMs: integer('warmup', 10, 10000), seed: integer('seed', 1, 2147483647), batchSize: 16, minSamples: 64,
  input: 'Fresh independent inputs for each call; creation excluded from timing, included in wall-clock budget',
  autoFreeze: false, subtractTimerOverhead: false };
process.env.NODE_ENV = 'production';
const selectedScenarios = values.scenario ? scenarios.filter(scenario => scenario.id === values.scenario) : scenarios;
if (!selectedScenarios.length) throw new Error(`Unknown scenario: ${values.scenario}`);

if (values.worker) {
  const job = JSON.parse(values.worker);
  const scenario = scenarios.find(candidate => candidate.id === job.scenario);
  assert.ok(scenario, 'unknown scenario');
  const implementation = job.implementation === 'handwritten' ? { id: 'handwritten' }
    : { id: job.implementation, produce: (await import(pathToFileURL(job.modulePath).href)).produce };
  verifyCase(implementation, scenario);
  const { Bench } = await import('tinybench');
  const bench = new Bench({ time: settings.timeMs, warmupTime: settings.warmupMs,
    iterations: settings.minSamples, warmupIterations: settings.minSamples,
    subtractTimerOverhead: false, retainSamples: false, throws: true });
  const warnings = [];
  bench.addEventListener('warning', event => warnings.push(event.reason));
  let inputs;
  let results;
  let seed = 0;
  bench.add('produce', () => {
    const iterationStart = bench.now();
    inputs = Array.from({ length: settings.batchSize }, () => scenario.create(++seed));
    results = new Array(settings.batchSize);
    const operationStart = bench.now();
    for (let index = 0; index < inputs.length; index++) {
      results[index] = execute(implementation, scenario, inputs[index]);
    }
    const end = bench.now();
    return { overriddenDuration: end - operationStart, overriddenIterationCost: end - iterationStart };
  });
  const [task] = bench.runSync();
  assert.equal(task.result.state, 'completed');
  for (let index = 0; index < inputs.length; index++) {
    const original = scenario.create(seed - settings.batchSize + index + 1);
    const expected = structuredClone(original);
    scenario.recipe(expected);
    assert.deepEqual(inputs[index], original);
    assert.deepEqual(results[index], expected);
    assert.equal(results[index].shared, inputs[index].shared);
    assert.equal(results[index] === inputs[index], Boolean(scenario.noop));
    scenario.check?.(results[index], inputs[index]);
  }
  const nsPerOp = task.result.latency.mean * 1e6 / settings.batchSize;
  assert.ok(Number.isFinite(nsPerOp) && nsPerOp > 0);
  console.log(JSON.stringify({ scenario: job.scenario, implementation: job.implementation, round: job.round,
    nsPerOp, samples: task.runs, rmePercent: task.result.latency.rme, warnings: [...new Set(warnings)] }));
} else {
  await main();
}

async function main() {
  const output = values.output && resolve(values.output);
  if (output) {
    const location = relative(root, output);
    if (!isAbsolute(values.output) || (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location))) {
      throw new Error('--output must be an absolute path outside the repository');
    }
    if (!existsSync(dirname(output)) || existsSync(output) || existsSync(`${output}.md`) || existsSync(`${output}.bundles`)) {
      throw new Error('Output parent must exist and all report paths must be new');
    }
  }
  const directory = output ? `${output}.bundles` : mkdtempSync(join(tmpdir(), 'lean-fns-produce-'));
  if (output) mkdirSync(directory);
  try {
    const sourceHashes = fingerprints();
    const build = await buildModules(directory, values.baseline);
    const implementations = await Promise.all(build.modules.map(async module => ({
      ...module, produce: (await import(pathToFileURL(module.path).href)).produce,
    })));
    implementations.push({ id: 'handwritten' });
    const verifiedChecks = verifyAll(implementations, selectedScenarios);
    if (values.verify) {
      console.log(`produce benchmark correctness: ${verifiedChecks} cases passed`);
      return;
    }
    const metadata = { startedAt: new Date().toISOString(), node: process.version, v8: process.versions.v8,
      platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model,
      versions: { immer: packageVersion('immer'), tinybench: packageVersion('tinybench') },
      git: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), dirty: Boolean(git('status', '--porcelain')) },
      sourceHashes, build, settings, verifiedChecks,
      scenarios: selectedScenarios.map(({ id, description }) => ({ id, description })),
      note: 'Same fixtures and recipes per implementation. No universal speed claim. Saved baseline module uses its original build. Handwritten implementations cover only the indicated operations.' };
    const jobs = [];
    let random = settings.seed;
    for (let round = 1; round <= settings.rounds; round++) {
      const batch = selectedScenarios.flatMap(scenario => implementations
        .filter(implementation => implementation.id !== 'handwritten' || scenario.handwritten)
        .map(implementation => ({ scenario: scenario.id, implementation: implementation.id, modulePath: implementation.path, round })));
      for (let index = batch.length - 1; index > 0; index--) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const other = random % (index + 1);
        [batch[index], batch[other]] = [batch[other], batch[index]];
      }
      jobs.push(...batch);
    }
    console.log(`Verified ${verifiedChecks} cases. Measuring ${jobs.length} sequential isolated processes.`);
    const results = [];
    for (const job of jobs) {
      const result = await worker(job);
      results.push(result);
      console.log(`[${results.length}/${jobs.length}] ${job.scenario} / ${job.implementation}: ${result.nsPerOp.toFixed(1)} ns/op`);
      if (result.warnings.length) console.warn(`Timing warning: ${result.warnings.join(', ')}`);
    }
    assert.deepEqual(fingerprints(), sourceHashes, 'Source/build/config changed during measurement');
    for (const module of build.modules) assert.equal(hash(readFileSync(module.path)), module.sha256, 'Measured module changed');
    const summary = selectedScenarios.flatMap(scenario => implementations.flatMap(implementation => {
      const runs = results.filter(row => row.scenario === scenario.id && row.implementation === implementation.id);
      if (!runs.length) return [];
      const times = runs.map(row => row.nsPerOp).sort((a, b) => a - b);
      const middle = Math.floor(times.length / 2);
      return [{ scenario: scenario.id, implementation: implementation.id,
        medianNsPerOp: times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2,
        minNsPerOp: times[0], maxNsPerOp: times.at(-1), maxRmePercent: Math.max(...runs.map(row => row.rmePercent)),
        warnings: [...new Set(runs.flatMap(row => row.warnings))] }];
    }));
    console.table(summary);
    const report = { metadata, completedAt: new Date().toISOString(), results, summary };
    if (output) {
      writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
      writeFileSync(`${output}.md`, markdown(report), { flag: 'wx' });
      console.log(`Report: ${output}`);
    }
  } finally {
    if (!output) rmSync(directory, { recursive: true, force: true });
  }
}

function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function fingerprints() {
  return Object.fromEntries(['src/produce.ts', 'src/index.ts', 'dist/index.js', 'package.json', 'pnpm-lock.yaml',
    'tsdown.config.ts', 'benchmarks/produce.mjs', 'benchmarks/produce-cases.mjs', 'benchmarks/produce-build.mjs']
    .map(path => [path, hash(readFileSync(resolve(root, path)))]));
}
function worker(job) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [script, '--worker', JSON.stringify(job), '--time', String(settings.timeMs),
      '--warmup', String(settings.warmupMs)], { cwd: root, env: { ...process.env, NODE_ENV: 'production' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Worker ${job.scenario}/${job.implementation} failed (${code}): ${stderr}`));
      try { resolveResult(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
}
function markdown({ metadata, summary }) {
  const lines = ['# produce comparison', '',
    `Node ${metadata.node}, Immer ${metadata.versions.immer}, ${metadata.cpu}. ${settings.rounds} rounds.`, '',
    'Median of per-process mean ns/op. Both libraries disable autoFreeze. Fresh fixtures; setup excluded. Ranges and warnings are in JSON. These measurements describe these fixtures and this machine.', '',
    '| Scenario | Implementation | Median ns/op | Min..max | Max RME % |', '| --- | --- | ---: | ---: | ---: |'];
  for (const row of summary) lines.push(`| ${row.scenario} | ${row.implementation} | ${row.medianNsPerOp.toFixed(1)} | ${row.minNsPerOp.toFixed(1)}..${row.maxNsPerOp.toFixed(1)} | ${row.maxRmePercent.toFixed(2)} |`);
  lines.push('', 'Standalone runtime exports, excluding declarations and sourcemaps. The saved baseline retains its original build.', '',
    '| Module | Minified bytes | gzip-9 bytes | Brotli-11 bytes |', '| --- | ---: | ---: | ---: |');
  for (const module of metadata.build.modules) lines.push(`| ${module.id} | ${module.minifiedBytes} | ${module.gzip9Bytes} | ${module.brotli11Bytes} |`);
  return `${lines.join('\n')}\n`;
}

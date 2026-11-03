const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const appPath = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

function createHarness() {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const document = { addEventListener() {} };
  const window = {};
  const sandbox = { window, document, localStorage, crypto: webcrypto, TextEncoder, Date, Math, JSON, Object, setTimeout, console };
  vm.runInNewContext(source, sandbox, { filename: 'app.js' });
  return { api: window.BlockVote, localStorage };
}

test('creates a SHA-256 Genesis Block and validates it', async () => {
  const { api } = createHarness(); await api.initialize();
  const genesis = await api.createGenesisBlock();
  assert.equal(genesis.index, 0);
  assert.equal(genesis.previousHash, '0'.repeat(64));
  assert.match(genesis.hash, /^[0-9a-f]{64}$/);
  assert.equal((await api.validateChain([genesis])).valid, true);
});

test('hash changes when block contents change and blocks link in sequence', async () => {
  const { api } = createHarness(); await api.initialize();
  const genesis = await api.createGenesisBlock();
  const block = await api.createBlock([{ transactionId: 't1', candidateId: 'candidate-a' }], genesis);
  assert.equal(block.index, 1);
  assert.equal(block.previousHash, genesis.hash);
  assert.equal((await api.calculateHash(block)), block.hash);
  const changed = structuredClone(block); changed.transactions[0].candidateId = 'candidate-b';
  assert.notEqual(await api.calculateHash(changed), block.hash);
  assert.equal((await api.validateChain([genesis, block])).valid, true);
});

test('addBlock appends a uniquely indexed block with the latest hash', async () => {
  const { api } = createHarness(); await api.initialize();
  const first = await api.addBlock([{ transactionId: 'one', candidateId: 'candidate-a' }]);
  const second = await api.addBlock([{ transactionId: 'two', candidateId: 'candidate-b' }]);
  assert.equal(first.index, 1); assert.equal(second.index, 2);
  assert.equal(second.previousHash, first.hash);
  assert.equal((await api.validateChain()).valid, true);
});

test('detects altered transaction data and a broken previous-hash link', async () => {
  const { api, localStorage } = createHarness(); await api.initialize();
  await api.addBlock([{ transactionId: 'one', candidateId: 'candidate-a' }]);
  await api.addBlock([{ transactionId: 'two', candidateId: 'candidate-b' }]);
  const validChain = JSON.parse(localStorage.getItem('blockvote.educational.v1')).chain;
  const altered = structuredClone(validChain);
  altered[1].transactions[0].candidateId = 'tampered';
  const tamperResult = await api.detectTampering(altered);
  assert.equal(tamperResult.valid, false);
  assert.ok(tamperResult.issues.some(issue => issue.index === 2), 'the next block must have a broken link');
  const brokenLink = structuredClone(validChain);
  brokenLink[2].previousHash = 'f'.repeat(64);
  assert.equal((await api.validateChain(brokenLink)).valid, false);
});

test('prevents invalid IDs, invalid candidates, and duplicate votes while keeping IDs out of blocks', async () => {
  const { api, localStorage } = createHarness(); await api.initialize();
  assert.equal(api.checkVoterEligibility('nope').eligible, false);
  assert.equal(api.checkVoterEligibility('voter001').eligible, true);
  assert.throws(() => api.setElectionStatus('ended'), /open election/);
  api.setElectionStatus('open');
  await assert.rejects(api.recordVote('NOTREGISTERED', 'candidate-a'), /Invalid demo voter ID/);
  await assert.rejects(api.recordVote('VOTER001', 'unknown-candidate'), /Invalid candidate/);
  await api.recordVote('VOTER001', 'candidate-a');
  await assert.rejects(api.recordVote('VOTER001', 'candidate-b'), /already voted/);
  const saved = JSON.parse(localStorage.getItem('blockvote.educational.v1'));
  assert.equal(saved.eligibility.VOTER001.voted, true);
  assert.equal(JSON.stringify(saved.chain).includes('VOTER001'), false);
  assert.equal(api.getLatestBlock().transactions.length, 1);
});

test('supports election start and end rules and calculates candidate totals', async () => {
  const { api } = createHarness(); await api.initialize();
  assert.equal(api.setElectionStatus('open'), 'open');
  await api.recordVote('VOTER001', 'candidate-a');
  await api.recordVote('VOTER002', 'candidate-a');
  await api.recordVote('VOTER003', 'candidate-b');
  assert.equal(api.getCounts()['candidate-a'], 2);
  assert.equal(api.getCounts()['candidate-b'], 1);
  assert.equal(api.setElectionStatus('ended'), 'ended');
  await assert.rejects(api.recordVote('VOTER004', 'candidate-a'), /not open/);
  assert.throws(() => api.setElectionStatus('open'), /only be started/);
});

test('persists election and chain state to LocalStorage and restores it', async () => {
  const { api, localStorage } = createHarness(); await api.initialize();
  api.setElectionStatus('open'); await api.recordVote('VOTER001', 'candidate-c');
  const saved = JSON.parse(localStorage.getItem('blockvote.educational.v1'));
  assert.equal(saved.chain.length, 2);
  assert.equal(saved.election.status, 'open');
  const next = createHarness(); next.localStorage.setItem('blockvote.educational.v1', JSON.stringify(saved));
  await next.api.initialize();
  assert.equal((await next.api.validateChain()).valid, true);
  assert.equal(next.api.getLatestBlock().index, 1);
});

test('JSON export includes election records and keeps voter IDs out of blockchain transactions', async () => {
  const { api } = createHarness(); await api.initialize(); api.setElectionStatus('open');
  await api.recordVote('VOTER001', 'candidate-a');
  const payload = api.createExportPayload();
  assert.equal(payload.blockchain.length, 2);
  assert.equal(payload.eligibility.VOTER001.voted, true);
  assert.equal(JSON.stringify(payload.blockchain).includes('VOTER001'), false);
  assert.match(payload.educationalNotice, /not decentralized/);
});

test('Vercel/mobile deployment settings are present', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.match(html, /export-button/);
  assert.match(source, /blockvote-election-data\.json/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.equal(config.version, 2);
});


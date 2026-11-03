/* BlockVote: educational, single-browser blockchain simulation. */
(() => {
  'use strict';
  const STORAGE_KEY = 'blockvote.educational.v1';
  const DEMO_IDS = Array.from({ length: 10 }, (_, i) => `VOTER${String(i + 1).padStart(3, '0')}`);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const copy = value => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function starterData() {
    return {
      election: { title: 'Classroom Election', description: 'A demo election. Change the title and candidates in Election admin.', status: 'not-started', createdAt: now() },
      candidates: [
        { id: 'candidate-a', name: 'Candidate 1', description: 'Demo candidate' },
        { id: 'candidate-b', name: 'Candidate 2', description: 'Demo candidate' },
        { id: 'candidate-c', name: 'Candidate 3', description: 'Demo candidate' }
      ],
      eligibility: Object.fromEntries(DEMO_IDS.map(id => [id, { voted: false }])),
      chain: [],
      results: null
    };
  }

  let state;
  let pendingVoter = null;
  let selectedCandidate = null;
  let tamperedChain = null;
  let currentUser = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return starterData();
      const parsed = JSON.parse(raw);
      if (!parsed?.election || !Array.isArray(parsed.candidates) || !parsed.eligibility || !Array.isArray(parsed.chain)) throw new Error('Unexpected saved data shape');
      if (parsed.election.title === 'School Student Council Election 2026') {
        parsed.election.title = 'Classroom Election';
        parsed.election.description = 'A demo election. Change the title and candidates in Election admin.';
        parsed.candidates.forEach((candidate, index) => {
          if (/^Candidate [ABC]$/.test(candidate.name)) {
            candidate.name = `Candidate ${index + 1}`;
            candidate.description = 'Demo candidate';
          }
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
      // Fill absent eligible demo IDs without changing any existing records.
      for (const id of DEMO_IDS) parsed.eligibility[id] ||= { voted: false };
      parsed.results ||= null;
      return parsed;
    } catch (error) {
      console.warn('BlockVote could not read saved data; starting a fresh demo.', error);
      setTimeout(() => toast('Saved demo data could not be read. A fresh demo election is ready.', true), 300);
      return starterData();
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { console.error('BlockVote could not save to LocalStorage.', error); toast('Browser storage could not save this change.', true); }
  }

  function canonicalBlock(block) {
    // Keep the hash payload deterministic; never hash the stored hash itself.
    return JSON.stringify({ index: block.index, timestamp: block.timestamp, transactions: block.transactions, previousHash: block.previousHash, nonce: block.nonce });
  }

  async function calculateHash(block) {
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable. Open this page on HTTPS or localhost in a modern browser.');
    const bytes = new TextEncoder().encode(canonicalBlock(block));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function createGenesisBlock() {
    const block = { index: 0, timestamp: now(), transactions: [], previousHash: '0'.repeat(64), nonce: 0 };
    block.hash = await calculateHash(block);
    return block;
  }

  async function createBlock(transactions, previousBlock) {
    const block = { index: previousBlock.index + 1, timestamp: now(), transactions: copy(transactions), previousHash: previousBlock.hash, nonce: 0 };
    block.hash = await calculateHash(block);
    return block;
  }

  async function ensureGenesis() {
    if (!state.chain.length) { state.chain.push(await createGenesisBlock()); persist(); }
  }

  async function addBlock(transactions) {
    await ensureGenesis();
    const block = await createBlock(transactions, getLatestBlock());
    state.chain.push(block);
    persist();
    return block;
  }

  function getLatestBlock(chain = state.chain) { return chain[chain.length - 1] || null; }

  async function validateChain(chain = state.chain) {
    const issues = [];
    if (!Array.isArray(chain) || chain.length === 0) return { valid: false, issues: [{ index: 0, reason: 'Genesis block is missing.' }] };
    if (chain[0].index !== 0 || chain[0].previousHash !== '0'.repeat(64)) issues.push({ index: 0, reason: 'Genesis block structure is invalid.' });
    const indexes = new Set();
    let previousCalculatedHash = null;
    for (let i = 0; i < chain.length; i++) {
      const block = chain[i];
      if (!Number.isInteger(block.index) || block.index !== i || indexes.has(block.index)) issues.push({ index: i, reason: 'Block index is missing, duplicated, or out of order.' });
      indexes.add(block.index);
      let expected;
      try { expected = await calculateHash(block); }
      catch (error) { return { valid: false, issues: [{ index: i, reason: error.message }] }; }
      if (expected !== block.hash) issues.push({ index: i, reason: 'Stored hash does not match the block contents.' });
      if (i > 0 && block.previousHash !== previousCalculatedHash) issues.push({ index: i, reason: 'Previous hash does not match the prior block contents.' });
      if (i > 0 && block.index !== chain[i - 1].index + 1) issues.push({ index: i, reason: 'Block index is not unique and sequential.' });
      previousCalculatedHash = expected;
    }
    return { valid: issues.length === 0, issues };
  }

  async function detectTampering(chain = state.chain) { return validateChain(chain); }

  function votesFrom(chain = state.chain) {
    return chain.slice(1).flatMap(block => Array.isArray(block.transactions) ? block.transactions : []);
  }

  function countsFrom(chain = state.chain) {
    const counts = Object.fromEntries(state.candidates.map(candidate => [candidate.id, 0]));
    for (const tx of votesFrom(chain)) if (Object.hasOwn(counts, tx.candidateId)) counts[tx.candidateId]++;
    return counts;
  }

  function checkVoterEligibility(voterId) {
    const id = String(voterId || '').trim().toUpperCase();
    if (!Object.hasOwn(state.eligibility, id)) return { eligible: false, reason: 'invalid-id' };
    if (state.eligibility[id].voted) return { eligible: false, reason: 'already-voted' };
    return { eligible: true, voterId: id };
  }

  async function recordVote(voterId, candidateId) {
    if (state.election.status !== 'open') throw new Error('Election is not open.');
    const eligibility = checkVoterEligibility(voterId);
    if (!eligibility.eligible) throw new Error(eligibility.reason === 'invalid-id' ? 'Invalid demo voter ID.' : 'This demo ID has already voted.');
    if (!state.candidates.some(candidate => candidate.id === candidateId)) throw new Error('Invalid candidate selection.');
    await verifyChainOrThrow();
    const transaction = { transactionId: newId(), candidateId, recordedAt: now() };
    const block = await addBlock([transaction]);
    // This eligibility flag is stored apart from the public vote transaction.
    state.eligibility[eligibility.voterId].voted = true;
    persist();
    return block;
  }

  function setElectionStatus(nextStatus) {
    if (nextStatus === 'open') {
      if (state.election.status !== 'not-started') throw new Error('Election can only be started once before reset.');
      if (!state.candidates.length) throw new Error('Add at least one candidate before starting.');
      state.election.status = 'open'; state.election.startedAt = now();
    } else if (nextStatus === 'ended') {
      if (state.election.status !== 'open') throw new Error('Only an open election can be ended.');
      state.election.status = 'ended'; state.election.endedAt = now();
    } else throw new Error('Unsupported election status.');
    persist(); return state.election.status;
  }

  function createExportPayload() {
    return { exportedAt: now(), educationalNotice: 'Local browser simulation; not decentralized or suitable for a public election.', election: copy(state.election), candidates: copy(state.candidates), eligibility: copy(state.eligibility), blockchain: copy(state.chain) };
  }

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  function toast(message, error = false) {
    const node = document.createElement('div'); node.className = `toast${error ? ' error' : ''}`; node.textContent = message;
    $('#toast-region').append(node); setTimeout(() => node.remove(), 3300);
  }
  function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
  function shortHash(value) { return value ? `${value.slice(0, 14)}…${value.slice(-8)}` : '—'; }

  async function update() {
    await ensureGenesis();
    renderDashboard(); renderResults(); renderAdmin(); renderVoting();
    await renderExplorer();
  }

  function renderDashboard() {
    const votes = votesFrom();
    $('#top-election').textContent = state.election.title;
    const title = escapeHtml(state.election.title);
    $('#hero-title').innerHTML = `${title.includes(' Election') ? title.replace(/ (Election)/, '<br><em>$1') + '</em>' : title}`;
    $('#hero-description').textContent = state.election.description;
    $('#stat-registered').textContent = Object.keys(state.eligibility).length;
    $('#stat-votes').textContent = votes.length;
    $('#stat-remaining').textContent = Object.values(state.eligibility).filter(record => !record.voted).length;
    $('#stat-candidates').textContent = state.candidates.length;
    const status = $('#election-status'); status.className = `status-chip ${state.election.status === 'open' ? 'open' : state.election.status === 'ended' ? 'ended' : ''}`;
    status.innerHTML = `<i></i> ${state.election.status === 'open' ? 'VOTING OPEN' : state.election.status === 'ended' ? 'ELECTION ENDED' : 'NOT STARTED'}`;
    const chain = $('#mini-chain'); chain.innerHTML = state.chain.map((block, index) => `${index ? '<span class="mini-link"></span>' : ''}<span class="mini-node${index === 0 ? ' genesis' : ''}" title="Block ${block.index}">${block.index === 0 ? 'G' : block.index}</span>`).join('');
    $('#credential-list').innerHTML = Object.entries(state.eligibility).map(([id, record]) => `<span class="credential${record.voted ? ' used' : ''}">${escapeHtml(id)}${record.voted ? ' · used' : ''}</span>`).join('');
    $('#vote-stat-caption').textContent = 'Blocks added to the chain';
  }

  async function renderExplorer() {
    const chain = tamperedChain || state.chain;
    const validity = await validateChain(chain);
    const status = $('#explorer-status'); status.className = `status-chip ${validity.valid ? 'open' : 'ended'}`; status.innerHTML = `<i></i> ${validity.valid ? 'VALID' : 'COMPROMISED'}`;
    $('#chain-count').textContent = `${chain.length} block${chain.length === 1 ? '' : 's'} in chain`;
    const cards = chain.map((block, index) => {
      const invalid = validity.issues.some(issue => issue.index === index) || (!validity.valid && index > (validity.issues[0]?.index ?? 0));
      const transactions = (block.transactions || []).map(tx => {
        const candidate = state.candidates.find(item => item.id === tx.candidateId);
        return `<span class="tx-tag">Anonymous vote${candidate ? ` · ${escapeHtml(candidate.name)}` : ' · modified data'}</span>`;
      }).join('') || '<span class="empty-tx">No vote transactions — this block starts the chain.</span>';
      return `<details class="block-card${index === 0 ? ' genesis' : ''}${invalid && tamperedChain ? ' tampered' : ''}" ${index === chain.length - 1 ? 'open' : ''}><summary class="block-summary"><span class="block-index">${String(block.index).padStart(2, '0')}</span><span class="block-main"><span class="block-title"><b>${index === 0 ? 'Genesis Block' : `Block ${block.index}`}</b>${index === 0 ? '<span class="genesis-badge">GENESIS</span>' : ''}</span><small>${formatTime(block.timestamp)}</small></span><span class="block-votes"><b>${(block.transactions || []).length} vote${(block.transactions || []).length === 1 ? '' : 's'}</b>${invalid && tamperedChain ? 'HASH MISMATCH' : 'transaction(s)'}</span><span class="expand">⌄</span></summary><div class="block-details"><div class="hash-field"><label>PREVIOUS HASH</label><div class="hash-value">${escapeHtml(block.previousHash)}</div></div><div class="hash-field"><label>BLOCK HASH ${invalid && tamperedChain ? '· INVALID' : ''}</label><div class="hash-value">${escapeHtml(block.hash)}</div></div><div class="hash-field"><label>BLOCK METADATA</label><div class="hash-value">Index ${block.index} · Nonce ${block.nonce}</div></div><div class="hash-field"><label>TIMESTAMP</label><div class="hash-value">${escapeHtml(block.timestamp)}</div></div><div class="transactions"><label>ANONYMIZED TRANSACTIONS</label><div class="transactions-list">${transactions}</div></div></div></details>`;
    }).join('');
    $('#block-list').innerHTML = cards;
    const health = $('#chain-health-title').closest('.chain-health'); health.classList.toggle('compromised', !validity.valid);
    $('#health-icon').textContent = validity.valid ? '✓' : '!';
    $('#chain-health-title').textContent = validity.valid ? 'Chain is valid' : 'Chain is compromised';
    $('#chain-health-copy').textContent = validity.valid ? 'Every block links to its predecessor.' : (validity.issues[0]?.reason || 'Hash mismatch detected.');
    $('#chain-valid-badge').textContent = validity.valid ? 'VALID' : 'INVALID';
    $('#tamper-button').classList.toggle('hidden', Boolean(tamperedChain));
    $('#restore-button').classList.toggle('hidden', !tamperedChain);
    $('#tamper-message').classList.toggle('hidden', !tamperedChain);
    $('#tamper-message').textContent = tamperedChain ? 'Tampering detected: stored hash mismatch and broken downstream hash links. Your real election chain is unchanged.' : '';
  }

  function renderResults() {
    const counts = countsFrom(); const total = votesFrom().length;
    $('#results-total').textContent = total;
    $('#results-election-status').textContent = state.election.status === 'open' ? 'Voting open' : state.election.status === 'ended' ? 'Ended' : 'Not started';
    if (!state.candidates.length) { $('#results-list').innerHTML = '<p class="empty-tx">No candidates have been added yet.</p>'; return; }
    $('#results-list').innerHTML = state.candidates.map(candidate => {
      const count = counts[candidate.id] || 0; const percent = total ? Math.round(count / total * 100) : 0;
      return `<div class="result-row"><div class="result-meta"><b>${escapeHtml(candidate.name)}</b><span>${count} vote${count === 1 ? '' : 's'} · ${percent}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div></div>`;
    }).join('');
  }

  function renderAdmin() {
    $('#election-name').value = state.election.title;
    $('#election-description').value = state.election.description;
    const locked = state.election.status !== 'not-started' || votesFrom().length > 0;
    $('#candidate-lock').textContent = locked ? 'LOCKED' : 'EDITABLE'; $('#candidate-lock').classList.toggle('locked', locked);
    $('#candidate-form').classList.toggle('hidden', locked);
    $('#admin-candidates').innerHTML = state.candidates.map(candidate => `<div class="admin-candidate"><b>${escapeHtml(candidate.name)}</b><small>${escapeHtml(candidate.description || 'No description')}</small>${locked ? '' : `<button data-edit="${escapeHtml(candidate.id)}" title="Edit candidate">✎</button><button data-remove="${escapeHtml(candidate.id)}" title="Remove candidate">×</button>`}</div>`).join('') || '<small class="form-hint">No candidates yet. Add at least one before opening voting.</small>';
    $('#start-election').disabled = state.election.status !== 'not-started' || !state.candidates.length;
    $('#end-election').disabled = state.election.status !== 'open';
    $('#admin-status-copy').textContent = state.election.status === 'open' ? 'Voting is open. Candidate changes are locked.' : state.election.status === 'ended' ? 'Election ended. Results remain available until reset.' : 'Voting has not started. You can still edit candidates.';
  }

  function renderVoting() {
    const open = state.election.status === 'open';
    $('#vote-closed').classList.toggle('hidden', open);
    const voterLogin = currentUser?.role === 'voter';
    const loggedInVoterUsed = voterLogin && state.eligibility[currentUser.id]?.voted;
    $('#voter-form').classList.toggle('hidden', !open || voterLogin);
    $('#candidate-step').classList.toggle('hidden', !open || !pendingVoter || loggedInVoterUsed);
    const feedback = $('#voter-feedback');
    if (voterLogin) {
      feedback.classList.remove('hidden', 'success', 'error');
      feedback.classList.add(loggedInVoterUsed ? 'error' : 'success');
      feedback.textContent = loggedInVoterUsed ? 'This demo ID has already voted.' : `Signed in as ${currentUser.id}. Choose a candidate below.`;
    }
    if (open && pendingVoter) {
      $('#vote-candidates').innerHTML = state.candidates.map(candidate => `<div class="candidate-option${selectedCandidate === candidate.id ? ' selected' : ''}" data-candidate="${escapeHtml(candidate.id)}"><span class="candidate-radio"></span><span><b>${escapeHtml(candidate.name)}</b><small>${escapeHtml(candidate.description)}</small></span></div>`).join('');
      $('#review-vote').disabled = !selectedCandidate;
    }
  }

  function enterApp(user, page) {
    currentUser = user;
    $('#login-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    $('#session-label').textContent = user.role === 'organizer' ? 'Organizer' : user.id;
    $$('[data-page="admin"]').forEach(link => link.classList.toggle('hidden', user.role !== 'organizer'));
    location.hash = `#${page}`;
    if (user.role === 'voter') {
      pendingVoter = user.id;
      selectedCandidate = null;
      $('#voter-id').value = user.id;
    } else {
      pendingVoter = null;
    }
    renderVoting();
  }

  function leaveApp() {
    currentUser = null; pendingVoter = null; selectedCandidate = null;
    $('#app-shell').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $('#login-voter-id').value = '';
    $('#login-organizer-password').value = '';
    $('#login-error').classList.add('hidden');
    location.hash = '';
  }

  async function verifyChainOrThrow() {
    const result = await validateChain();
    if (!result.valid) throw new Error(`Blockchain integrity check failed at block ${result.issues[0].index}.`);
  }

  function initNavigation() {
    function navigate() {
      const page = location.hash.replace('#', '') || 'dashboard';
      let valid = ['dashboard', 'vote', 'explorer', 'results', 'admin', 'learn'].includes(page) ? page : 'dashboard';
      if (currentUser?.role === 'voter' && valid === 'admin') valid = 'vote';
      $$('.page').forEach(section => section.classList.toggle('active', section.id === `page-${valid}`));
      $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === valid));
      $('#sidebar').classList.remove('open'); window.scrollTo(0, 0);
    }
    window.addEventListener('hashchange', navigate); navigate();
    $('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#main-nav').addEventListener('click', event => { if (event.target.closest('a')) $('#sidebar').classList.remove('open'); });
  }

  function initEvents() {
    $$('[data-login-role]').forEach(button => button.addEventListener('click', () => {
      const organizer = button.dataset.loginRole === 'organizer';
      $$('[data-login-role]').forEach(tab => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      $('#voter-login-form').classList.toggle('hidden', organizer);
      $('#organizer-login-form').classList.toggle('hidden', !organizer);
      $('#login-error').classList.add('hidden');
    }));
    $('#voter-login-form').addEventListener('submit', event => {
      event.preventDefault();
      const id = $('#login-voter-id').value.trim().toUpperCase();
      if (!Object.hasOwn(state.eligibility, id)) {
        $('#login-error').textContent = 'That demo ID is not registered. Use VOTER001 through VOTER010.';
        $('#login-error').classList.remove('hidden'); return;
      }
      $('#login-error').classList.add('hidden');
      enterApp({ role: 'voter', id }, 'vote');
    });
    $('#organizer-login-form').addEventListener('submit', event => {
      event.preventDefault();
      const name = $('#login-organizer-name').value.trim();
      const password = $('#login-organizer-password').value;
      if (name.toLowerCase() !== 'organizer' || password !== 'classroom') {
        $('#login-error').textContent = 'Organizer sign-in did not match the demo credentials.';
        $('#login-error').classList.remove('hidden'); return;
      }
      $('#login-error').classList.add('hidden');
      enterApp({ role: 'organizer', name }, 'admin');
    });
    $('#logout-button').addEventListener('click', leaveApp);

    $('#toggle-credentials').addEventListener('click', event => {
      const list = $('#credential-list'); list.classList.toggle('hidden'); event.currentTarget.textContent = list.classList.contains('hidden') ? 'Show IDs +' : 'Hide IDs −';
    });

    $('#voter-form').addEventListener('submit', event => {
      event.preventDefault(); const id = $('#voter-id').value.trim().toUpperCase(); const feedback = $('#voter-feedback');
      feedback.classList.remove('hidden', 'success', 'error');
      if (currentUser?.role === 'voter') { feedback.classList.add('error'); feedback.textContent = 'Sign out to switch voter IDs.'; return; }
      if (!Object.hasOwn(state.eligibility, id)) { feedback.classList.add('error'); feedback.textContent = 'That demo ID is not registered. Try VOTER001 through VOTER010.'; pendingVoter = null; }
      else if (state.eligibility[id].voted) { feedback.classList.add('error'); feedback.textContent = 'This demo ID has already voted. Each registered ID can vote once.'; pendingVoter = null; }
      else { pendingVoter = id; selectedCandidate = null; feedback.classList.add('success'); feedback.textContent = 'ID verified. Choose a candidate below.'; }
      renderVoting();
    });

    $('#vote-candidates').addEventListener('click', event => {
      const option = event.target.closest('[data-candidate]'); if (!option) return;
      selectedCandidate = option.dataset.candidate; renderVoting();
    });

    $('#review-vote').addEventListener('click', () => {
      const candidate = state.candidates.find(item => item.id === selectedCandidate); if (!pendingVoter || !candidate) return;
      $('#confirm-copy').textContent = `Your anonymous vote for ${candidate.name} will be recorded in a new SHA-256 linked block.`;
      $('#confirm-dialog').showModal();
    });
    $('#cancel-vote').addEventListener('click', () => $('#confirm-dialog').close());
    $('#submit-vote').addEventListener('click', async () => {
      const button = $('#submit-vote'); button.disabled = true;
      try {
        if (!pendingVoter) throw new Error('Verify a registered demo ID first.');
        await recordVote(pendingVoter, selectedCandidate);
        $('#confirm-dialog').close(); pendingVoter = null; selectedCandidate = null; $('#voter-id').value = ''; $('#voter-feedback').classList.add('hidden');
        toast('Vote recorded. A new block has been added to the chain.'); await update(); location.hash = '#explorer';
      } catch (error) { toast(error.message, true); }
      finally { button.disabled = false; }
    });

    $('#election-form').addEventListener('submit', event => {
      event.preventDefault(); state.election.title = $('#election-name').value.trim() || 'Classroom Election'; state.election.description = $('#election-description').value.trim(); persist(); update(); toast('Election details saved.');
    });
    $('#candidate-form').addEventListener('submit', event => {
      event.preventDefault(); if (state.election.status !== 'not-started' || votesFrom().length) return toast('Candidate editing is locked.', true);
      const name = $('#candidate-name').value.trim(); if (!name) return;
      state.candidates.push({ id: newId(), name, description: $('#candidate-description').value.trim() || 'No description provided.' });
      $('#candidate-form').reset(); persist(); update(); toast('Candidate added.');
    });
    $('#admin-candidates').addEventListener('click', event => {
      const editId = event.target.dataset.edit; const removeId = event.target.dataset.remove;
      if (state.election.status !== 'not-started' || votesFrom().length) return;
      if (editId) {
        const candidate = state.candidates.find(item => item.id === editId); if (!candidate) return;
        const name = window.prompt('Edit candidate name:', candidate.name); if (name === null) return;
        const description = window.prompt('Edit short description:', candidate.description); if (description === null) return;
        if (!name.trim()) return toast('Candidate name cannot be empty.', true);
        candidate.name = name.trim(); candidate.description = description.trim(); persist(); update(); toast('Candidate updated.');
      }
      if (removeId) {
        if (state.candidates.length <= 1) return toast('At least one candidate is required.', true);
        state.candidates = state.candidates.filter(item => item.id !== removeId); persist(); update(); toast('Candidate removed.');
      }
    });
    $('#start-election').addEventListener('click', () => {
      if (state.election.status !== 'not-started' || !state.candidates.length) return;
      try { setElectionStatus('open'); update(); toast('Election is open. Candidate list is locked.'); } catch (error) { toast(error.message, true); }
    });
    $('#end-election').addEventListener('click', () => {
      if (state.election.status !== 'open') return;
      if (!window.confirm('End voting now? No more demo votes will be accepted.')) return;
      try { setElectionStatus('ended'); update(); toast('Election ended. Results are available.'); } catch (error) { toast(error.message, true); }
    });
    $('#reset-election').addEventListener('click', () => {
      if (!window.confirm('Reset the demo election and remove its votes from this browser? This cannot be undone.')) return;
      state = starterData(); pendingVoter = null; selectedCandidate = null; tamperedChain = null; persist(); update(); toast('Demo election reset.'); location.hash = '#dashboard';
    });
    $('#create-election').addEventListener('click', async () => {
      if (!window.confirm('Start a new election? This clears the current demo votes and candidates.')) return;
      state = starterData();
      state.election.title = 'New Election';
      state.election.description = '';
      state.candidates = [];
      pendingVoter = null; selectedCandidate = null; tamperedChain = null;
      persist(); await update(); location.hash = '#admin'; toast('New election created. Add a title and candidates to begin.');
    });

    $('#tamper-button').addEventListener('click', async () => {
      if (state.chain.length < 3) return toast('Cast at least two demo votes so the altered block has a later link to break.', true);
      tamperedChain = copy(state.chain);
      const target = tamperedChain.find(block => block.index === 1) || tamperedChain[1];
      target.transactions[0] = { ...target.transactions[0], candidateId: 'tampered-candidate-data' };
      const result = await detectTampering(tamperedChain);
      await renderExplorer();
      toast(result.valid ? 'Unexpected result: no mismatch found.' : 'Tampering detected. Chain integrity failed.', !result.valid);
    });
    $('#restore-button').addEventListener('click', async () => { tamperedChain = null; await renderExplorer(); toast('Original election blockchain restored.'); });

    $('#export-button').addEventListener('click', () => {
      // The export separates eligibility from vote transactions and never puts IDs into blocks.
      const payload = createExportPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'blockvote-election-data.json'; anchor.click(); URL.revokeObjectURL(url); toast('Blockchain data exported as JSON.');
    });
  }

  async function boot() {
    state = loadState();
    initNavigation(); initEvents();
    try { await ensureGenesis(); await update(); }
    catch (error) { console.error(error); toast(error.message || 'BlockVote could not initialize.', true); }
  }

  // Expose named engine methods for the classroom console and direct inspection.
  window.BlockVote = {
    initialize: async () => { state ||= loadState(); await ensureGenesis(); return copy(state); },
    createGenesisBlock, calculateHash, createBlock, addBlock, validateChain, getLatestBlock,
    detectTampering, checkVoterEligibility, recordVote, getCounts: countsFrom, setElectionStatus, createExportPayload
  };
  document.addEventListener('DOMContentLoaded', boot);
})();


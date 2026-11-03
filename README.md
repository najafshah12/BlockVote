# BlockVote — Blockchain-Based Election System

BlockVote is an educational election simulation for Grade 8 and Grade 9 students. It demonstrates SHA-256 hashes, linked blocks, a separate eligibility list, anonymized candidate vote records, and visible tamper detection.

> This project demonstrates blockchain concepts through a local JavaScript simulation. It is designed for educational purposes and is not suitable for real public elections.

## Run locally

No build step, API key, package install, or external blockchain service is needed. The browser's Web Crypto API requires a secure context, so use HTTPS or localhost. For example, from this folder:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Run the checks

With Node.js installed, run the built-in test suite from this folder:

```bash
node --test tests/blockchain.test.cjs
```

## Deploy to Vercel

1. Put the contents of this folder in a Git repository.
2. Import that repository in Vercel and select the project root containing `index.html`.
3. Use the **Other** framework preset with no build command and no output directory. The site is static; `vercel.json` contains compatible response headers.
4. Deploy. No environment variables or paid services are needed.

You can also install the Vercel CLI and run `vercel` from this folder. The public URL is assigned by Vercel after deployment; this local build has not been deployed to an external account.

## Try the classroom demo

1. Open **Election admin** and start the election.
2. Open **Cast a vote** and use one of `VOTER001` through `VOTER010`.
3. Pick a candidate and confirm the vote.
4. Explore the new block under **Blockchain explorer** or check tallies under **Election results**.
5. Select **Simulate data tampering** to edit a temporary chain copy. Restore it to return the explorer to the real chain.

The initial election is **School Student Council Election 2026**, with Candidate A, Candidate B, and Candidate C. Voter IDs are demonstration credentials only.

## Data and limitations

The demo stores election state in browser LocalStorage. It is not secure, decentralized, or immutable storage. The eligibility record stores whether an ID has voted; blockchain transactions contain a candidate ID and random transaction ID, but no voter ID. Results are computed from those transactions. A browser user can inspect or alter local data, and SHA-256 by itself does not provide voter authentication, election security, distributed consensus, or independent verification.

**Do not use BlockVote for a real election.**

## Project files

- `index.html` — responsive dashboard and app sections
- `styles.css` — visual design and mobile layouts
- `app.js` — custom blockchain engine and interactive election logic
- `vercel.json` — static deployment headers

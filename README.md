# BlockVote — Blockchain-Based Election System

BlockVote is a browser-based election simulator for setting up an election, casting test votes, and checking linked blocks.

> BlockVote uses a local JavaScript simulation to explain blockchain. It is for education and is not suitable for real public elections.

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

## Sign in and try it

The organizer sign-in for this local build is `organizer` / `classroom`. This front-end sign-in only separates screens; it is not secure authentication.

Registered voter IDs are `VOTER001` through `VOTER010`. The default election is called **Classroom Election**. Use **New election** in the organizer controls to start with a blank candidate list, then add the title and candidates you need.

Start voting, sign in with a voter ID, cast a vote, and view the new block or results. The tamper test changes a temporary copy of the chain.

## Data and limitations

The app stores election state in browser LocalStorage. It is not secure, decentralized, or immutable storage. The eligibility record stores whether an ID has voted; blockchain transactions contain a candidate ID and random transaction ID, but no voter ID. Results are computed from those transactions. A browser user can inspect or alter local data, and SHA-256 by itself does not provide voter authentication, election security, distributed consensus, or independent verification.

**Do not use BlockVote for a real election.**

## Project files

- `index.html` — responsive dashboard and app sections
- `styles.css` — visual design and mobile layouts
- `app.js` — custom blockchain engine and interactive election logic
- `vercel.json` — static deployment headers


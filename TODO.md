# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [ ] Only show last 10 threads for a given project
- [ ] Thread archiving
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update

## Bigger things

- [ ] Queueing messages

Here's where we stand:

Published to GitHub: main branch is up to date with all changes.

npm publish blocked: You need an npm account to publish t3delta. The name t3delta is available (confirmed). To complete the publish:

1. Create/login to npm at https://www.npmjs.com
2. Run in your terminal:
   bash
   npm login
   cd ~/projects/t3delta/apps/server
   bun run build
   bun scripts/cli.ts publish --tag latest --access public

3. Verify: npm install -g t3delta on another machine

Your data is safe. Publishing only uploads code to npm. Your projects, sessions, and settings live locally in ~/.t3delta/ (or wherever T3CODE_HOME points). Nothing gets uploaded or deleted.

Alternative if you don't want npm: I can set up a GitHub Release workflow that builds binaries and attaches them as downloadable artifacts. Users would download a .zip/.dmg instead of running npm install.

Want me to set up the GitHub Actions release workflow so you can publish without needing an npm account?

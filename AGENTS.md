# Directions for coding agents

You are working in a copy of ChompChomp.io, a Multiplayer Agent starter. It belongs to whoever
cloned or remixed it now. Two values must be that person's own. The key's placeholder is marked
`REPLACE_ME`; the email is in no file at all, so ask for it:

| What | Where | Replace with |
| --- | --- | --- |
| Game key | `mp.config.local.js` (copy it from `mp.config.local.example.js`) | The publishable key (`pk_...`) of the user's own game, from `create_game` or `remix_game` |
| Email | Ask the user, then use it for `connect_account` and for `git config user.email` in this repo | The email the user wants their games saved under, and the one they commit as (their GitHub noreply address is a good choice) |

Find the key's placeholders with `grep -rn REPLACE_ME .`

## Rules

- **Never put a real key in a committed file.** The committed `mp.config.js` keeps
  `pk_REPLACE_ME`, and that is what makes a fresh clone run offline against bots. The real key
  goes only in `mp.config.local.js`, which is gitignored. Don't add a fallback key anywhere in
  the code.
- **Never commit an email, a name or a path that isn't the user's.** Use `Player1`, `tester` or
  `bot-3` in test data, and paths relative to the repo.
- **Put your own notes in `.notes/`** (gitignored), not in the repo.

## Making it the user's own game

The Multiplayer Agent plugin does all of this with `/multiplayer-agent:remix chompchomp-io`. By hand:

1. `create_game` with the user's label (the name decides the share link, so set it first).
2. Copy `mp.config.local.example.js` to `mp.config.local.js` and put the new key in it.
3. `node build.js`, then `deploy_room_logic` with `dist/server.js` to the room `arena` at tick rate 20.
4. `publish_game` with `index.html`, `style.css`, `mp.config.js`, `mp.config.local.js`,
   `powerups.js`, `sim.js`, `local.js` and `game.js`. A publishable key in a live page is public
   by design; it only has to stay out of git.

The README has the rest: how the game works, the file layout and the anti-cheat.

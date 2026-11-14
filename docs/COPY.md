# Peershell — Copy Deck

Single source of truth for every visible string across the landing page, the
pairing screen, and the terminal session. Variants are listed where there's
a real choice; the recommendation is marked `→ RECOMMENDED` with one line
explaining why.

Voice rules in force throughout this file: short sentences, active verbs,
specific over vague, no marketing adjectives, no exclamation points, no
emoji, no AI-tells ("Whether you're X or Y", "It's not just X — it's Y",
"Imagine if..."), no buzzword features that don't exist in the product.

---

## Landing page (`/`)

### Nav

**Wordmark**

| Variant | |
|--|--|
| `peershell` (all lowercase, mono) | → RECOMMENDED. Reads as a CLI binary name, which is what it is. |
| `Peershell` (sentence case) | Less native to the audience. |
| `~/peershell` | Cute but reads as a path; misleading. |

**Nav links (three slots → real anchors on the page)**

| Variant | |
|--|--|
| `How it works` · `Features` · `Use cases` | → RECOMMENDED. Names match the section anchors and the order users would scan. |
| `Install` · `How it works` · `GitHub` | "Install" wants a real page; we don't have one. |
| `Docs` · `GitHub` · `Web App` | Pushes the destination off-site; the landing's job is to explain, not link out. |

**Primary CTA button (right side of nav)**

| Variant | |
|--|--|
| `Open the web client` | → RECOMMENDED. Says exactly what clicking does — opens `/app`. No promise of speed or magic. |
| `Connect to a machine` | Accurate for the viewer flow but presumes you already have a code. |
| `Try it` | Vague; reads like a marketing button, not a destination. |

---

### Hero

**Kicker pill (small label above the headline)**

| Variant | |
|--|--|
| `● PEER-TO-PEER · LINUX · MACOS` | → RECOMMENDED. Leads with the differentiator (peer-to-peer), platforms second. |
| `● OPEN SOURCE · LINUX + MACOS · WEBRTC` | Slightly noisier; "open source" lives better in the features section. |
| `● A TERMINAL, OVER WEBRTC` | Punchy but already says what the headline will say. |

**Headline (giant text; one italic accent word/phrase)**

| Variant | Italic accent | |
|--|--|--|
| `Share your terminal, no tunnel.` | `no tunnel.` | → RECOMMENDED. Tells you what's different in three words. Reads aloud the way a dev would actually pitch it. |
| `Your terminal, in a browser.` | `in a browser.` | Accurate but understates the P2P angle. |
| `Share your shell, peer-to-peer.` | `peer-to-peer.` | Technical and correct but the hyphenation is awkward in display type. |

**Subheadline (1–2 sentences expanding the headline)**

| Variant | |
|--|--|
| `Run the agent. Read a 6-digit code. Someone enters it in their browser and they're in your terminal. No port forwarding, no ngrok, no tunnel. The connection goes directly between the two of you over WebRTC.` | → RECOMMENDED. Walks the reader through the actual flow in plain order, then names the technical thing. |
| `A peer-to-peer terminal session in seconds. No SSH, no tunnel, no port forwarding. Just a code and a browser.` | Tighter but loses the "what actually happens" beat. |
| `Hand your terminal to anyone with a browser. Encrypted by default. Your data never touches our server.` | Strong on positioning but skips the "how" — readers want the mechanic. |

**Install command label (small caps above the install pill)**

| Variant | |
|--|--|
| `ONE COMMAND` | → RECOMMENDED. Doesn't restate "install"; rewards the user who's about to read the actual command. |
| `INSTALL` | Fine but a touch redundant given the `$` prompt right below it. |
| `RUN THIS` | Reads as a CTA, not a label. |

**Install command itself**

| Variant | |
|--|--|
| `curl -fsSL peershell.app/install.sh \| sh` | → RECOMMENDED. The convention users already trust (rustup, deno, k3s use the same shape). |
| `curl -fsSL get.peershell.app \| sh` | Slightly shorter; needs a subdomain and a content-type that returns the script — extra ops. |
| `brew install peershell` | Add as a second line for macOS users; do not replace the curl line. |

**Feature check-badges row (4 badges)**

| Variant | |
|--|--|
| `Peer-to-peer` · `Encrypted by default` · `No tunnel` · `Open source` | → RECOMMENDED. Each badge is a concrete fact, not a vibe. Drops "free forever" — open source is the better signal. |
| `Peer-to-peer` · `Encrypted` · `Zero config` · `Free forever` | "Free forever" reads as SaaS pricing, which we are not. |
| `WebRTC` · `DTLS encrypted` · `Cross-platform` · `MIT licensed` | More accurate but reads like a spec sheet. |

---

### How it works section

**Section kicker**

| Variant | |
|--|--|
| `HOW IT WORKS` | → RECOMMENDED. Clear, matches the anchor `#how-it-works`. |
| `THE FLOW` | Tries too hard. |
| `THREE STEPS` | Restates what's in the heading. |

**Section heading**

| Variant | |
|--|--|
| `Three commands. No infrastructure.` | → RECOMMENDED. Concrete promise; "infrastructure" pre-empts the question "do I need a server?". |
| `From install to a shared session in 30 seconds.` | True but the number reads as marketing. |
| `Install. Pair. Connect.` | Punchy but the next section already lists those three steps. |

**Section subheading**

| Variant | |
|--|--|
| `The same flow on every machine: install the agent, share the code, hand it off.` | → RECOMMENDED. Names what stays constant; reassures the cautious reader. |
| `From a fresh laptop to a paired session in under a minute.` | Time claim invites disagreement; cut. |

**Step 01 — Install the agent**

| Variant | |
|--|--|
| Title: `Install the agent` <br> Body: `One curl command on Linux or macOS. The agent is a single Go binary with no dependencies; nothing else gets installed.` | → RECOMMENDED. Names the platforms, names the language (signals "self-contained, small"), explicitly disclaims dependency creep. |
| Title: `Install` <br> Body: `One command. No dependencies. No daemon you forgot you were running.` | More terse but loses the "what gets installed" beat. |

**Step 02 — Get the pairing code**

| Variant | |
|--|--|
| Title: `Read the code` <br> Body: `Run \`peershell\`. The agent prints a 6-digit code and waits. Send the code to whoever needs in.` | → RECOMMENDED. Uses the actual command verb the user will type. "Waits" implies low overhead. |
| Title: `Share the code` <br> Body: `A 6-digit code shows up in your terminal. Paste it into Slack, a text message, a sticky note.` | The "sticky note" line is cute but distracts. |
| Title: `Get your code` <br> Body: `The agent gives you a code. Anyone with the code can open your terminal.` | Reads slightly threatening — "anyone with the code" is true but uncomfortable on a homepage. |

**Step 03 — Someone connects from a browser**

| Variant | |
|--|--|
| Title: `They open the web client` <br> Body: `They enter the code in a browser. WebRTC negotiates a direct connection between the two of you. They're in your terminal.` | → RECOMMENDED. Names the mechanism (WebRTC) without dwelling on it; the punchline is the last sentence. |
| Title: `They're in` <br> Body: `They open peershell.app, type the code, and start typing. No accounts, no install on their side.` | Punchy but skips the "what's actually happening under the hood" beat, which this audience values. |

---

### Features section (new — not in Skyping)

> Bar: each card says one specific thing, not a vibe. If the description could
> sit on any other tool's page, rewrite it.

**Card 1**

| | |
|--|--|
| Title | `Truly peer-to-peer` |
| Body  | `Our signaling server introduces you to the other peer and steps out of the way. Terminal bytes flow directly between the two machines. We can't read your session because we're not in it.` |

**Card 2**

| | |
|--|--|
| Title | `Encrypted by default` |
| Body  | `Every byte is DTLS-encrypted by WebRTC. There's no opt-in, no certificate to manage, no "enable TLS" checkbox. The connection is encrypted or it doesn't open.` |

**Card 3**

| | |
|--|--|
| Title | `Through any NAT` |
| Body  | `WebRTC handles NAT traversal with STUN. The agent doesn't need a public IP; the viewer's browser doesn't need a port open. Most home and office networks just work.` |

**Card 4**

| | |
|--|--|
| Title | `30-second setup` |
| Body  | `One install command on the host. One code into a browser on the other side. No accounts. No keys to exchange beforehand.` |

**Card 5**

| | |
|--|--|
| Title | `Open source` |
| Body  | `MIT-licensed agent, signaling server, and web client. The protocol is documented. Self-host the whole stack on a $5 VPS if you want to.` |

**Card 6**

| | |
|--|--|
| Title | `Linux and macOS` |
| Body  | `Single binary on both. Spawns whatever shell you live in — bash, zsh, fish, nushell. Windows support is on the roadmap.` |

---

### Use cases section (new — not in Skyping)

> Bar: each one should read like a scene the writer has actually been in.
> Avoid hypotheticals.

**Use case 1**

| | |
|--|--|
| Title | `Pair-debugging without screen-share lag` |
| Body  | `Skip the video call. Drop the code in the chat. Your teammate gets a real terminal at native speed, not 12fps video of yours.` |

**Use case 2**

| | |
|--|--|
| Title | `Helping a colleague who's stuck` |
| Body  | `Their build is broken in a way that only reproduces on their machine. They run the agent, you connect, you fix it from their shell. Hand it back when you're done.` |

**Use case 3**

| | |
|--|--|
| Title | `Reaching your own dev box` |
| Body  | `On a different network, no VPN, can't be bothered to set up Tailscale. The agent runs on the dev box, the browser runs on your laptop, you're back in.` |

---

### Final CTA section

**Heading**

| Variant | |
|--|--|
| `Open the web client.` | → RECOMMENDED. Declarative, names the next action, matches the button. |
| `Ready to share your terminal?` | Question format invites the answer "not yet." |
| `Stop tunneling.` | Strong but a touch aggressive for the closing beat. |

**Subheading**

| Variant | |
|--|--|
| `Install the agent on the host. Enter the code on the viewer. The rest is just typing.` | → RECOMMENDED. Walks through both ends; ends on the part the user already knows how to do. |
| `Two terminals. One code. No infrastructure between them.` | Cleaner but skips the "what you do" verbs. |

**Primary CTA button**

| Variant | |
|--|--|
| `Open the web client` | → RECOMMENDED. Matches the nav CTA — consistent label across the page. |
| `Enter a code` | More specific but breaks the nav consistency. |

**Secondary CTA button**

| Variant | |
|--|--|
| `Read the source on GitHub` | → RECOMMENDED. Active verb, names the audience action. |
| `View on GitHub` | Skyping's wording; fine but passive. |
| `Star on GitHub` | Asks for a favor; bad first impression. |

---

### Footer

**Wordmark tagline (under the wordmark, one line)**

| Variant | |
|--|--|
| `A terminal, shared peer-to-peer.` | → RECOMMENDED. Restates the one-line value without re-pitching. |
| `Share your terminal, peer-to-peer.` | Reuses the Skyping cadence; we should sound different. |
| `Two terminals, one code.` | Catchy but doesn't say what the product is. |

**Column 1 — Product**

| | |
|--|--|
| Heading | `Product` |
| Links   | `How it works` · `Features` · `Web client` |

**Column 2 — Developers**

| | |
|--|--|
| Heading | `Developers` |
| Links   | `GitHub` · `Documentation` · `Protocol spec` |

**Column 3 — Project**

| | |
|--|--|
| Heading | `Project` |
| Links   | `About` · `License (MIT)` · `Changelog` |

**Bottom microcopy**

| Variant | |
|--|--|
| `Made for developers who'd rather not tunnel.` | → RECOMMENDED. Specific audience, specific motivation, no "with love." |
| `An open-source project. MIT licensed.` | True but reads as legal boilerplate. |
| `Built with care for developers` | "Built with care" is the new "with love." Cut. |

---

## Pairing screen (`/app` — before connection)

### Nav status indicator (right side of the nav, replaces the CTA)

**Agent ready / listening for a code**

| Variant | |
|--|--|
| `● Ready` | → RECOMMENDED. Short, calm, matches the agent's own "Waiting for connections..." idle state. |
| `● Listening` | Slightly more accurate but reads as a microphone metaphor. |
| `● Online` | Implies an account or a session; we have neither. |

**Signaling server reachable but no inbound activity yet** (same state as Ready in practice; reuse `● Ready`).

**Searching / connecting in progress**

| Variant | |
|--|--|
| `● Connecting…` | → RECOMMENDED. The ellipsis signals "in flight" without animation. |
| `● Pairing…` | Accurate but "pairing" feels Bluetooth-y. |

**Connection error**

| Variant | |
|--|--|
| `● Disconnected` | → RECOMMENDED. Honest, matches the dot color shift to muted/red. |
| `● Offline` | Implies you're at fault when the server might be down. |
| `● Lost connection` | Verbose; the user already sees a status pill. |

### Kicker pill (above headline)

| Variant | |
|--|--|
| `● ENTER A PAIRING CODE` | → RECOMMENDED. Tells the user what to do, in the same shape as the landing's kicker. |
| `● CONNECT TO A MACHINE` | Skyping's; "machine" is fine, but "enter a code" is the actual action. |
| `● PAIR WITH AN AGENT` | "Agent" is internal jargon; not every viewer knows the product split. |

### Headline (italic accent word)

| Variant | Italic accent | |
|--|--|--|
| `Got a code? Type it in.` | `Type it in.` | → RECOMMENDED. Conversational. Names the only thing the user needs to do. Italic verbs hit harder than italic nouns. |
| `Enter your pairing code.` | `pairing code.` | Skyping's structure with our word; it works but doesn't say anything new. |
| `Six digits, then a terminal.` | `then a terminal.` | Clever but a touch riddle-y. |

### Subheading

| Variant | |
|--|--|
| `The host's terminal prints a 6-digit code. Type it here to open a peer-to-peer session.` | → RECOMMENDED. Names where the code comes from and what happens next. |
| `Type the 6-digit code from the host's machine to start the session.` | Tight but skips the "P2P" beat which justifies why we exist. |

### Connect button label (when 6 digits entered)

| Variant | |
|--|--|
| `Connect` | → RECOMMENDED. Verb, single word, doesn't need elaboration. |
| `Open terminal` | Premature — we haven't reached the terminal yet. |
| `Pair` | Reads as Bluetooth. |

### Error messages (status line below the code boxes)

| State | Copy |
|--|--|
| Code not found | `That code doesn't match an active agent. Check the digits with the host and try again.` |
| Code expired | `That code expired. Codes live for 10 minutes — ask the host to run the agent again for a fresh one.` |
| Rate limited | `Too many attempts from this address. Wait a minute, then try again.` |
| Agent already paired | `That agent is already connected to someone else. One viewer per code; ask the host to start a new session.` |

> Rule for error copy: name the problem, name the fix, no "Sorry" or "Oops."

### "Don't have the agent installed?" helper block

**Heading inside the dark terminal block**

| Variant | |
|--|--|
| `New here? Install the agent first.` | → RECOMMENDED. Names the audience (someone landing without context), names the action. |
| `Don't have the agent installed?` | Skyping's; works but the question framing makes the answer optional. |
| `Run the host side first.` | Accurate but cryptic without context. |

**Helper sub-line above the install command (single line)**

| Variant | |
|--|--|
| `Run this on the machine you want to share.` | → RECOMMENDED. Tells the user where to run it; doesn't restate "install." |
| `Install the Peershell agent.` | Redundant with the heading. |

---

## Terminal session screen (`/app` — after pairing)

### Top bar connection status label

**Connected state — base shape**

`● Connected · {hostname}` — recommended when the protocol carries the hostname through. If the hostname isn't available, fall back to `● Connected · {code}`.

| Variant | |
|--|--|
| `● Connected · macbook-pro` | → RECOMMENDED. Names the machine you're in; matches the prompt convention. |
| `● Live session · macbook-pro` | "Live" is overused on streaming products. |
| `● Paired with macbook-pro` | "Paired" reads as Bluetooth in this context too. |

**Fallback when hostname missing** — `● Connected · 483-291`. The code is concrete; never show a hyphen-less form.

### Session timer

**Format**

| Variant | |
|--|--|
| `MM:SS` under 1h, `H:MM:SS` over 1h. Example: `04:21`, `1:12:08`. | → RECOMMENDED. Standard ssh/tmux convention; no leading zero on hours. |
| `Xm Ys` ("4m 21s") | Reads as a duration label, not a running clock. |
| `00:04:21` always | Pads with zeros that never change for short sessions. |

**Hover tooltip on the timer**

| Variant | |
|--|--|
| `Session started 4 minutes ago` | → RECOMMENDED. Confirms what the live count means; useful on long sessions. |
| `Connected at 14:23` | Local timezone footprint — fine but less universal. |

### Disconnect button + confirmation modal

**Button label (top right)**

| Variant | |
|--|--|
| `Disconnect` | → RECOMMENDED. The only verb that's honest. |
| `End session` | Slightly softer; both work. |
| `Leave` | Reads as a meeting metaphor. |

**Confirmation modal — heading**

| Variant | |
|--|--|
| `End this session?` | → RECOMMENDED. Question shape signals it's confirmable; verb matches the consequence. |
| `Are you sure?` | Tells the user they should hesitate without naming what. |
| `Disconnect from {hostname}?` | Names the host but most users care more about the action than the target. |

**Confirmation modal — body**

| Variant | |
|--|--|
| `Closes the terminal and tears down the peer connection. The host's shell process will exit. You'll need a new code to reconnect.` | → RECOMMENDED. Spells out what disconnecting actually does — important because the host's shell really does die. |
| `This will end the connection. Reconnecting will need a new code.` | Lighter but skips the "shell process exits" beat that a host might want to know. |

**Confirm button**

| Variant | |
|--|--|
| `Disconnect` | → RECOMMENDED. Matches the trigger; no "Yes, disconnect" double-confirm. |
| `End session` | Fine if the button at the top says "End session." |

**Cancel button**

| Variant | |
|--|--|
| `Stay connected` | → RECOMMENDED. Tells you what cancel does in this context. |
| `Cancel` | Universal but vague when paired with a destructive action. |
| `Back` | Implies a multi-step flow; this is a modal. |

### Session-ended overlay (when the channel closes for any reason)

**Heading**

| Variant | |
|--|--|
| `Session ended.` | → RECOMMENDED. Period, not exclamation. Doesn't dramatize. |
| `Disconnected.` | Truthful but slightly cold for the "user just lost their work" moment. |
| `Connection closed.` | Reads as a network error log. |

**Subline (one line)**

| Variant | Use when |
|--|--|
| `The host disconnected, or the network dropped.` | → RECOMMENDED. Names the two likely causes without finger-pointing. |
| `The peer connection was closed.` | Technically accurate, emotionally flat. |
| `Hand on. Reconnect with a fresh code from the host.` | Skip — sounds like a chatbot. |

**Reconnect CTA**

| Variant | |
|--|--|
| `Enter a new code` | → RECOMMENDED. Names what reconnecting actually requires. |
| `Reconnect` | Misleading — the old code is dead. |
| `Try again` | The user did nothing wrong; "try again" implies they did. |

---

## Share copy (bonus — optional)

> Use case: the host wants to send the code to a colleague over Slack /
> email / text. The pairing screen could expose a "Copy message" button next
> to the code; the variants below are the templates that button copies.

**Casual (Slack, friends)**

| Variant | |
|--|--|
| `peershell code: 483-291 — open peershell.app and punch it in` | → RECOMMENDED. Lowercase, em dash, no formality. Matches the way you'd actually drop a code in a DM. |
| `here's a peershell code for you: 483-291 (peershell.app)` | Wordier; the parenthetical reads as marketing. |

**Neutral (work chat, ticket comment)**

| Variant | |
|--|--|
| `Peershell pairing code: 483-291. Open https://peershell.app and enter the code to join my terminal.` | → RECOMMENDED. Adds the "what it does" beat for someone who hasn't seen the tool before. |
| `Code 483-291 — peershell.app` | Too cryptic if the recipient doesn't know the tool. |

**Professional (email, customer support)**

| Variant | |
|--|--|
| `I've started a Peershell terminal session. Please open https://peershell.app and enter the pairing code 483-291 to join. The session is peer-to-peer and encrypted; the code expires in 10 minutes.` | → RECOMMENDED. Names the tool, names the URL, names the code, names the security and TTL — the things a non-developer recipient will want to know. |
| `Use code 483-291 at peershell.app to connect to my terminal session.` | Fine but drops the security/TTL context. |

---

## Notes for the design phase

- The italic accent on the hero — `no tunnel.` in the recommended headline — needs to read as a phrase, not a word. Two-word italic is unusual in display type; if it looks awkward in layout we can shrink the accent to just `no tunnel` without the period.
- The "Six digits, then a terminal." variant is held in reserve in case the recommended `Got a code? Type it in.` reads too casual at giant display sizes.
- For the connection status pill, the divider character should be a centered dot (`·`, U+00B7) with hair space on either side — not an en-dash, not a pipe. This is a copy decision masquerading as a typography one.
- Wherever the agent is referenced as a noun, use lowercase ("the agent"). The product is "Peershell" capitalized; the binary and the process are lowercase.

# Master Prompt Template v2 — Jekono AI er jonno
### HiddenGem Flow er script bananor template

**Eta ki:** ekta fill-in-the-blanks template. Jekono AI ke (ChatGPT, Claude, Gemini, Groq — jekono ta) ei template ta dile se tomar extension er jonno userscript baniye dibe.

**Keno jekono AI bujhbe:** template er vitorei HiddenGem Flow er sob niyom lekha ache — script er format, ki ki GM API ache, ki kora jabe na. AI ke alada kore kichu bujhate hobe na.

**Tumi shudhu 2 ta jinish likhbe:** (1) website er link, (2) task gulo. **GOAL likhte hobe na** — AI nije task gulo pore goal bujhe nibe, ar script er naam/description nije banabe.

**Kivabe use korbe (3 step):**
1. Nicher template ta copy kore shudhu WEBSITE ar TASKS bhorbe.
2. Jekono AI ke paste koro.
3. Script ta ashle HiddenGem Flow er Script Manager e giye New Script → paste koro → scan er por confirm korle install hobe. Auto-install hoy na.

---

## THE TEMPLATE (copy-paste koro)

```
You are writing a userscript for HiddenGem Flow, a Chrome MV3 extension that runs userscripts with chrome.userScripts. The user will paste your script into the extension's script editor. Output the COMPLETE script in one code block, ready to paste, plus a 2-line summary before it.

GOAL: Do NOT ask for a goal. Derive the goal from the WEBSITE + TASKS below. The script's @name and @description must come from them.

WEBSITE: [paste the full URL, e.g. https://firstprint.fun/app/#/earn]
TASKS — do them in order, one step at a time:
Step 1 — WHERE: [page/section, e.g. "the Earn page, top Daily Streak card"] | DO: [action, e.g. "find the button with text 'Claim +50' and click it"] | WAIT AFTER: [e.g. 3 seconds] | DONE WHEN: [how to know it worked, e.g. "the button disappears or becomes disabled"]
Step 2 — WHERE: [...] | DO: [...] | WAIT AFTER: [...] | DONE WHEN: [...]
(add more steps as needed — copy the Step line)

RUN RULES (leave the defaults if you have nothing to change):
- Delay between steps: [default: 3 to 5 seconds, random in that range]
- Run: [default: once when the page opens]
- Stop when: [e.g. "after the last step succeeds" / "after 3 failed tries"]
- If a step fails: [default: retry it 2 times, then stop and show the reason in the status panel]
- Never do: [default: "never click Confirm inside the wallet popup — the user confirms it", "never ask for or use a private key or seed phrase", "never click Follow/Join buttons"]

=== HIDDEN GEM FLOW SCRIPT RULES (follow all of them) ===
HEADER: start with a ==UserScript== block: @name (short, from the tasks), @namespace HiddenGemFlow, @version 1.0.0, @description (one line, from the tasks), @match (exactly the WEBSITE URL above), @grant GM_setValue, @grant GM_getValue, @grant GM_notification, @run-at document-idle.
GM APIS AVAILABLE (only these): GM_setValue / GM_getValue (values are stored per-script, visible on the page — NEVER store secrets or keys in them), GM_notification (show a notification), GM_addStyle (add CSS), GM_setClipboard (copy text), GM_xmlhttpRequest (only if a @connect host is listed — do NOT add @connect unless a task needs to fetch another site).
STATUS PANEL: show a small panel at the bottom-right with the current step, last result, and a Start/Stop button.
CONSTRAINTS:
- Only run on the @match URL above. Never run on other sites.
- Wait up to 30 seconds for each element to appear before giving up on that step.
- Find elements by their visible text or aria-label, never by a long fragile CSS path.
- Do not use eval, new Function, document.write, or innerHTML with page data.
- Keep the code readable with short comments on each step.
```

---

## Shudhu 2 ta jinish bhorbe — kivabe

- **WEBSITE:** puro link, hash soho (jemon `#/earn`). Hash chara dile script bhul page e cholte pare.
- **TASKS:** prottek step e 4 ta jinish likhtei hobe:
  1. **WHERE** — page er kothay (button ta kothay, kon card/section e)
  2. **DO** — ki korbe (click, type, wait, check)
  3. **WAIT AFTER** — step er por koto second wait korbe
  4. **DONE WHEN** — kivabe bujhbe step ta hoyeche (button gayeb, text bodle gelo, address dekhacche). Eta na likhle script bujhbe na step sesh hoyeche kina.
- **RUN RULES:** kichu na likhleo cholbe — default delay 3–5 second, ekbar cholbe, fail korle 2 bar retry kore thambe. Bodlate chaile likho.
- **GOAL:** kichu likhte hobe na. AI task gulo pore nije bujhbe script ta ki kore, ar naam/description nije banabe.

---

## FILLED EXAMPLE — Firstprint Daily Claim (GOAL chara)

```
WEBSITE: https://firstprint.fun/app/#/earn
TASKS:
Step 1 — WHERE: the Earn page, top Daily Streak card | DO: find the button with text "Claim +50" and click it | WAIT AFTER: 3 seconds | DONE WHEN: the button disappears or becomes disabled, or the points total increases

RUN RULES:
- Delay between steps: 3 to 5 seconds, random in that range
- Run: once when the Earn page opens, at most once per UTC day
- Stop when: the claim succeeds, or the button is not there (already claimed or not logged in)
- If a step fails: retry 2 times, then stop and show the reason in the status panel
- Never do: never sign a wallet transaction, never click Follow on X or Join Telegram buttons
```

---

## Tips (draft valo pawar jonno)

1. **Button ke text diye cheno** (jemon "Claim +50") — CSS path diye na. Text bodlay na, path bodlay.
2. **Prottek step e DONE WHEN likho** — nahole script andaje cholbe, vul step e atke jabe.
3. **Ekta script e ekta kaj** — 10 ta task ek script e na; alada script, alada draft.
4. **Delay random range e dao** (3–5 sec) — fixed 1 sec dile site bot vabte pare.
5. **Wallet er kaj thakle "Never do" te likho** — Confirm user nije chapbe, script na.
6. **Script ashle age pore dekho** — editor e paste korar por scan hobe, tarpor confirm. Kono script nije install hoy na.
7. **AI ke template er baire kichu bolo na** — template ei sob ache; extra kotha bolle draft elomelo hote pare.

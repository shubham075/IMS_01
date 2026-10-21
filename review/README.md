# Review Hub

`Idea01_Review.html` is one offline file containing all project docs (in reading order) and the two finance/legal skills. Use it to read and review the docs.

## Use
1. Open `Idea01_Review.html` in **Chrome or Edge** (double-click). Enter your name once.
2. **File ▾ → Open existing / Create new reviews.json** and pick `review/reviews.json`. After that, every note and status auto-saves to that file and reloads next time (the chip turns blue). In other browsers, notes stay in the browser; use **Export JSON / Import & merge**.
3. Select text → **Highlight** or **Add note**. Click a highlight to edit, reply, or resolve it.
4. Click the **○** chip next to any ID (FR-*, D-*, L-*, S3…) → Approved / Needs change / Question.
5. Press `/` to search all docs or jump to an ID. Underlined IDs are links. **Dashboard** shows what needs attention; **Continue** returns to where you stopped reading.

## Team review
Each reviewer exports their `reviews.json` (or works on a shared copy). **Import & merge** combines files; nothing is lost.

## Rebuild after docs change
```bash
python review/build.py
```
The rebuild bakes `review/reviews.json` into the HTML, so new copies open with all saved notes. Notes stay attached to their text even when docs change; if the text was edited away, the note shows a ⚠ marker in the notes list.

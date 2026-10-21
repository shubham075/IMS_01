# Design system v0.1 — "Flat bold" (decision D-24)

Source of truth for how the apps look. Reference implementation: `design/prototypes/merchant-onboarding.html`. Reusable tokens: `codebase/packages/ui/src/tokens.css`.

## 1. Palette (exactly four colours, nothing else)
| Token | Hex | Role |
|---|---|---|
| `ink` | `#242424` | All text, borders, hard shadows, primary buttons, icons |
| `paper` | `#F2F2E8` | Page and card backgrounds, text on `ink` |
| `volt` | `#DFFF00` | **Attention and selection**: selected state, "Available" label, warnings and errors, highlights, decorative accents |
| `grey` | `#9B9E95` | Secondary fills only: side panels, neutral pills, hover, completed items |

Overlays (modal backdrop, soft text) are `ink` at reduced opacity, not new colours.

### Contrast (WCAG 2.1, computed)
| Pair | Ratio | Use |
|---|---|---|
| ink on paper | 13.8 | Body text ✔ |
| ink on volt | 13.6 | Text on highlighted items ✔ |
| ink on grey (same ratio as grey on ink) | 5.7 | Text on grey fills ✔ (AA) |
| paper on ink | 13.8 | Text on primary buttons, table headers ✔ |
| grey on paper / grey on volt | 2.4 | ❌ **Never use grey for text or for information-carrying icons** |
| paper on volt | 1.0 | ❌ Never |

Rules: never convey meaning by colour alone (always pair with text or an icon); disabled controls drop to 45% opacity.

## 2. Shape and depth
- Borders: **2.5px solid ink** on cards, inputs and buttons (2px on small chips).
- Shadows: **hard offset, no blur**: cards `6px 6px 0 ink`, small cards `4–5px`, buttons `3px 3px 0 ink`. Pressed = shadow removed and element moves 3px.
- Radius: 10px cards, 8px buttons and inputs, 6px chips and checkboxes.
- No gradients, no blur, no transparency effects.

## 3. Components (behaviour in the prototype)
| Component | Rule |
|---|---|
| Primary button | `ink` fill, `paper` text; hover → `volt` fill with `ink` text |
| Secondary button | `paper` fill, ink border; hover → `grey` |
| Selected option / toggle-on | `volt` fill |
| Input | `paper`, ink border; focus → `volt` hard shadow + visible ink focus ring |
| Checkbox | Custom: empty `paper` box; checked = `volt` with ink tick (no browser default colours) |
| Error / warning | `volt` block with ink border and a leading "!"; text states what to do. Fields also get `aria-invalid` |
| Info banner, neutral pill | `grey` fill |
| Availability label | "Available" = `volt`; every other state = `grey` (state is in the words, not the colour) |
| Table | `ink` header row with `paper` text; rows separated by 2px ink lines |
| Stepper | Done = `volt` square with ✓; current = `paper` card with border; upcoming = outlined |

## 4. Layout and ergonomics (shop conditions: sun, small phones, one hand)
- Minimum touch target **48px** (36px only for secondary inline actions).
- Type: system font stack with Noto Sans / Noto Sans Devanagari; body 16px; headings 21–27px. Hindi gets the same sizes (no shrinking).
- One primary action per screen, bottom-right of the form (desktop) or full-width (phone).
- Phone frame: single column; two-column grids collapse to one (KPI tiles stay 2-up).
- Language switch (English / Hindi) always reachable; all text comes from translation tables.

## 5. Icons
Emoji are drawn as flat ink silhouettes (`color: transparent; text-shadow: 0 0 0 ink`); custom SVG uses only palette fills (e.g. the map pin). Final apps should use one monochrome icon set (outline, 2px stroke, ink).

## 6. Audit
Checked in the browser across 22 screens and states (login, errors, offline banner, OTP, all steps, pharmacy block, payment modal, failure): computed text, background, border, outline, shadow and SVG colours are **all within the four palette colours**. Re-run the audit after any visual change.

## 7. Open design questions
1. Should the **consumer** app use the same style, or a calmer variant (same palette)?
2. Is `volt` for errors acceptable to merchants (it reads as "look here", not "danger")? Test with 3–5 shopkeepers.
3. The Review Hub page still uses the earlier clay palette (#263D8D, #A9C4E8, #F3DEA0, #FAF7EE). Switch it too?

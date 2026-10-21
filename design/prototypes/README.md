# Merchant onboarding prototype (login → shop → location → products → stock → go public → plans)

`merchant-onboarding.html` is one self-contained file (no internet, no build). Open it by double-click, or use the preview server config `prototypes` (port 8766). All data is fake; nothing is sent anywhere.

**Design:** "Flat bold" with exactly four colours: #242424 ink, #F2F2E8 paper, #DFFF00 volt, #9B9E95 grey (decision D-24; spec in `../DESIGN_SYSTEM.md`). The earlier clay style was dropped. A browser audit of 22 screens/states found no colour outside the four.

Use the top bar for language (English / Hindi), view (desktop / phone frame) and **Simulate**.

## Things to try (they show how errors are handled, docs/01)
- Login: empty form errors; wrong mobile number; wrong code (5 tries, then 30 s lock); resend timer; WhatsApp / call fallback; 3 code requests then a 1-hour limit. The demo code is **123456**.
- **Simulate**: *Offline* (banner, actions fail with a clear message), *SMS provider down* (auto-switch to WhatsApp), *Payment fails* (plans → Premium trial → failure and retry).
- Shop: GSTIN format check (use `29AAAAA0001A1Z5`); choose **Medicines** to see the "can't be shown publicly yet" rule.
- Location: tap or drag the pin; opening hours with a "closing after opening" check.
- Products: upload the sample CSV (2 problem rows with fixes), type items, or load 12 sample items; scanning is explained as mobile-only.
- Stock: invalid quantity message; "just in / out of stock" switch.
- Go public: checklist, publishing blocked until the map pin is set, live preview of what shoppers see (status only, never the exact number).
- Plans: **sample content only** (plan contents and prices are undecided, D-22).

## Quick links
`merchant-onboarding.html?step=plans&lang=hi&device=phone` — `step` = login, otp, org, branch, products, stock, publish, plans, done.

## Review questions for the team
1. Are the onboarding steps in the right order? Can any be dropped for the first run?
2. Is asking for the map pin and opening hours this early too much?
3. Should "Opening stock" be skippable?
4. Is the volt (bright yellow-green) for errors and warnings clear to shopkeepers? Test with 3–5 of them.
5. Hindi wording: natural for shopkeepers?

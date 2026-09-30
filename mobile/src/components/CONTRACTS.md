# Component contracts (fixed names — do not rename)

Originally stubbed by the foundation builder; all four are now real
implementations. Keep the export names and props stable.

| File | Export | Props | Owner | Original stub |
| --- | --- | --- | --- | --- |
| `split-transcript.tsx` | `SplitTranscript` | `TranscriptProps` (exported from `transcript.tsx`) | transcript | renders the paired `<Transcript>` |
| `pro-ai-tools.tsx` | `ProAiTools` | `{ sessionId; sourceLanguage; targetLanguage; segments: { id; sourceText; translatedText }[] }` → `ReactElement \| null` | pro-tools | returns `null` |
| `lang-dropdown.tsx` | `LangDropdown` | `{ value: string; onChange(code): void; label?: string }` | pro-tools | trigger + `AnchoredPopover` list of `LANGUAGES` |
| `locale-switcher.tsx` | `LocaleSwitcher` | `{ variant?: "pill" \| "row" }` | settings-auth-nav | trigger + `AnchoredPopover` of `UI_LOCALES` → `setLocale` |

## Routes (app/_layout.tsx, foundation-owned)

- Signed in: `(tabs)`, `session/[id]` (native push, transparent header).
- Signed out, in order: `welcome` (initial), `sign-in`, `forgot-password`.
  - `sign-in` is `presentation: "transparentModal"`, `animation: "fade"`,
    `animationDuration: 150` (the web auth popup's 150ms overlay fade, in and
    out). The screen must paint its own backdrop (web: rgba(6,11,24,.55) +
    blur) and glass card; animate the card's zoom .95→1 itself
    (`TW_ENTER.dialog`).
  - `welcome.tsx` (the landing) and `forgot-password.tsx` are implemented.

## i18n

`useT()` from `~/i18n`: `t(webMessageKey | nativeKey, fallbackOrVars?, vars?)`.
Native-only strings go in `src/i18n/strings/<owner>.ts`, keys prefixed
`<owner>.` (English required). UI-language RTL: use `useLocale().dir` with
`rtlText(dir)` / `rtlRow(dir)` — never `I18nManager`.

import type { NativeStrings } from "../types";

/**
 * Native-only strings owned by the foundation builder (shared dialogs, error
 * screen, auth gate, route stubs). The web hard-codes these in English inside
 * shared/confirm-dialog, shared/prompt-dialog and (app)/error.tsx, so they have
 * no MessageKey there.
 */
export const FOUNDATION_STRINGS = {
  "foundation.confirm": { en: "Confirm" },
  "foundation.cancel": { en: "Cancel" },
  "foundation.save": { en: "Save" },
  "foundation.close": { en: "Close" },
  "foundation.working": { en: "Working…" },
  "foundation.saving": { en: "Saving…" },
  "foundation.somethingWrongRetry": { en: "Something went wrong. Try again." },
  "foundation.errorTitle": { en: "Something went wrong" },
  "foundation.errorUnexpected": { en: "An unexpected error occurred." },
  "foundation.errorRef": { en: "ref: {ref}" },
  "foundation.tryAgain": { en: "Try again" },
  "foundation.loading": { en: "Loading" },
  "foundation.forgotTitle": { en: "Reset your password" },
  "foundation.backToSignIn": { en: "Back to sign in" },
} satisfies NativeStrings;

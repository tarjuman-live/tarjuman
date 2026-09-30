import type { NativeStrings } from "../types";

/**
 * Native-only strings owned by the "settings-auth-nav" builder (Settings tab,
 * sign-in / sign-up, forgot password, LocaleSwitcher). Prefer the web's
 * MessageKeys (t("settings.title"), t("lp.signIn") …) — everything here is
 * HARD-CODED English on the web (settings/page.tsx, auth-form.tsx,
 * forgot-password-form.tsx, locale-switcher.tsx, (legal)/layout.tsx), copied
 * verbatim. Key format: "settingsAuthNav.<name>" (not "settings." — that is a
 * web MessageKey namespace, and web keys win on a clash).
 */
export const SETTINGS_AUTH_NAV_STRINGS = {
  // ── LocaleSwitcher (shared/locale-switcher.tsx) ──
  // Settings header back tile (web: aria-label="Back")
  "settingsAuthNav.back": { en: "Back" },
  "settingsAuthNav.searchLanguages": { en: "Search languages…" },
  "settingsAuthNav.noLanguages": { en: "No languages found." },

  // ── Settings: account (settings/page.tsx) ──
  "settingsAuthNav.yourAccount": { en: "Your account" },
  "settingsAuthNav.changePicture": { en: "Change profile picture" },
  "settingsAuthNav.imageNotImage": { en: "Please choose an image file." },
  "settingsAuthNav.imageTooBig": { en: "Image must be under 5 MB." },
  "settingsAuthNav.imageUploadFailed": { en: "Upload failed. Please try again." },
  "settingsAuthNav.imageUpdateFailed": { en: "Couldn't update your picture." },
  "settingsAuthNav.displayNameLabel": { en: "Shown on your account and avatar." },
  "settingsAuthNav.displayNamePlaceholder": { en: "Your name" },

  // ── Settings: languages / subscription / audio / onboarding ──
  "settingsAuthNav.defaultPairHint": { en: "New recordings start with this pair." },
  "settingsAuthNav.proTitle": { en: "Tarjuman Pro" },
  "settingsAuthNav.proBadge": { en: "✦ Pro" },
  "settingsAuthNav.cancelsOn": { en: "Cancels {date}" },
  "settingsAuthNav.cancelsAtEnd": { en: "Cancels at period end" },
  "settingsAuthNav.renewsOn": { en: "Renews {date}" },
  "settingsAuthNav.activeSubscription": { en: "Active subscription" },
  "settingsAuthNav.manageBilling": { en: "{status} · Manage billing" },
  "settingsAuthNav.upgrade": { en: "Upgrade" },
  "settingsAuthNav.upgradeSub": { en: "{price} · see all plans" },
  "settingsAuthNav.usageLine": {
    en: "{su} of {sl} sessions · {mu} of {ml} summaries used this month.",
  },
  "settingsAuthNav.focusSpeakerDesc": { en: "Drop other voices when several speakers are detected." },
  "settingsAuthNav.tipsResetDone": { en: "Tips will show next time you record." },
  "settingsAuthNav.tipsResetSub": { en: "Re-show the mic positioning guide." },

  // ── Settings: sign out (native row; web keeps it in the account menu) ──
  "settingsAuthNav.signOut": { en: "Sign out" },
  // ── AccountMenu (auth/account-menu.tsx; sidebar rail footer) ──
  "settingsAuthNav.accountMenu": { en: "Account menu" },
  "settingsAuthNav.signedIn": { en: "Signed in" },
  "settingsAuthNav.signOutConfirmTitle": { en: "Sign out?" },
  "settingsAuthNav.signOutConfirmMessage": { en: "You can sign back in any time with the same account." },

  // ── Settings: danger zone ──
  "settingsAuthNav.deleting": { en: "Deleting…" },
  "settingsAuthNav.deleteWarning": {
    en: "Permanently removes your account, sessions, and summaries. This cannot be undone.",
  },
  "settingsAuthNav.deleteTitle": { en: "Delete your account?" },
  "settingsAuthNav.deleteMessage": {
    en: "All your sessions, transcripts, and summaries will be permanently removed. This cannot be undone.",
  },
  "settingsAuthNav.continue": { en: "Continue" },
  "settingsAuthNav.lastChanceTitle": { en: "Last chance" },
  "settingsAuthNav.lastChanceMessage": {
    en: "Tap Delete to permanently erase your account and everything in it. There is no undo.",
  },
  "settingsAuthNav.deleteForever": { en: "Delete forever" },
  "settingsAuthNav.deleteErrorTitle": { en: "Couldn't delete account" },
  "settingsAuthNav.deleteErrorMessage": {
    en: "Couldn't delete your account: {error}. Please try again or contact support.",
  },
  "settingsAuthNav.ok": { en: "OK" },

  // ── Legal footer ((legal)/layout.tsx) ──
  "settingsAuthNav.privacy": { en: "Privacy" },
  "settingsAuthNav.terms": { en: "Terms" },

  // ── Auth form (auth-form.tsx) ──
  "settingsAuthNav.brand": { en: "Tarjuman" },
  "settingsAuthNav.createTitle": { en: "Create your account" },
  "settingsAuthNav.welcomeBack": { en: "Welcome back" },
  "settingsAuthNav.signUpSub": { en: "Sign up to save your transcripts across devices." },
  "settingsAuthNav.signInSub": {
    en: "Sign in to access your transcript history and continue where you left off.",
  },
  "settingsAuthNav.email": { en: "Email" },
  "settingsAuthNav.password": { en: "Password" },
  "settingsAuthNav.confirmPassword": { en: "Confirm password" },
  "settingsAuthNav.forgotShort": { en: "Forgot?" },
  "settingsAuthNav.show": { en: "Show" },
  "settingsAuthNav.hide": { en: "Hide" },
  "settingsAuthNav.showPassword": { en: "Show password" },
  "settingsAuthNav.hidePassword": { en: "Hide password" },
  "settingsAuthNav.minChars": { en: "At least {n} characters." },
  "settingsAuthNav.emailRequired": { en: "Email is required." },
  "settingsAuthNav.emailInvalid": { en: "Enter a valid email." },
  "settingsAuthNav.passwordRequired": { en: "Password is required." },
  "settingsAuthNav.mismatch": { en: "Passwords don't match." },
  "settingsAuthNav.createAccount": { en: "Create account" },
  "settingsAuthNav.or": { en: "or" },
  "settingsAuthNav.continueGoogle": { en: "Continue with Google" },
  "settingsAuthNav.haveAccount": { en: "Already have an account? " },
  "settingsAuthNav.newTo": { en: "New to Tarjuman? " },
  "settingsAuthNav.createOne": { en: "Create one" },
  "settingsAuthNav.googleFailed": { en: "Google sign-in didn't complete. Try again." },
  "settingsAuthNav.errSignUpServer": {
    en: "Couldn't create your account. The email may already be registered — try signing in instead, or use a different email.",
  },
  "settingsAuthNav.errSignInServer": {
    en: "Couldn't sign in. Check your email and password, then try again. If you don't have an account yet, sign up first.",
  },
  "settingsAuthNav.errBadCredentials": { en: "Email or password is incorrect." },
  "settingsAuthNav.errSignUpFailed": { en: "Could not create account. Try again or use Google sign-in." },
  "settingsAuthNav.errAlreadyExists": { en: "An account with that email already exists. Sign in instead." },
  "settingsAuthNav.errInvalidEmail": { en: "That email address doesn't look valid." },
  "settingsAuthNav.errPasswordShort": { en: "Password must be at least {n} characters." },
  "settingsAuthNav.errTooMany": { en: "Too many attempts. Wait a minute and try again." },
  "settingsAuthNav.errNetwork": { en: "Couldn't reach the server. Check your connection and try again." },

  // ── Forgot password (forgot-password-form.tsx) ──
  "settingsAuthNav.fpEnterCode": { en: "Enter the code" },
  "settingsAuthNav.fpRequestSub": {
    en: "Enter the email associated with your account. We'll send a 6-digit code to reset your password.",
  },
  "settingsAuthNav.fpVerifySub": {
    en: "We sent a 6-digit code to {email}. Enter it below along with your new password.",
  },
  "settingsAuthNav.fpGoogleLead": { en: "Signed up with Google? There's no password to reset — go " },
  "settingsAuthNav.fpGoogleLink": { en: "back to sign in" },
  "settingsAuthNav.fpGoogleTail": { en: " and use “Continue with Google” instead." },
  "settingsAuthNav.fpSendCode": { en: "Send reset code" },
  "settingsAuthNav.fpSending": { en: "Sending…" },
  "settingsAuthNav.fpSixDigit": { en: "6-digit code" },
  "settingsAuthNav.fpNewPassword": { en: "New password" },
  "settingsAuthNav.fpConfirmNew": { en: "Confirm new password" },
  "settingsAuthNav.fpUpdatePassword": { en: "Update password" },
  "settingsAuthNav.fpUpdating": { en: "Updating…" },
  "settingsAuthNav.fpDifferentEmail": { en: "Use a different email" },
  "settingsAuthNav.fpUpdated": { en: "Password updated" },
  "settingsAuthNav.fpTakingYou": { en: "Taking you to sign in…" },
  "settingsAuthNav.fpCodeRequired": { en: "Code is required." },
  "settingsAuthNav.fpCodeInvalidCheck": { en: "That code isn't valid. Check the email and try again." },
  "settingsAuthNav.fpCodeInvalid": { en: "That code is invalid or expired. Request a new one below." },
  "settingsAuthNav.fpCodeExpired": { en: "That code has expired. Request a new one below." },
  "settingsAuthNav.fpNoAccount": { en: "No account found with that email." },
  "settingsAuthNav.fpResendRejected": {
    en: "Couldn't send the email. The Resend integration may not be configured yet — check Convex logs for the code as a dev fallback.",
  },
  "settingsAuthNav.fpSendFailed": { en: "Couldn't send a reset code right now. Please try again in a moment." },
  "settingsAuthNav.fpNoPasswordAccount": {
    en: "We couldn't find an email-and-password account for that email. If you signed up with “Continue with Google”, go back to sign in and use that instead.",
  },
} satisfies NativeStrings;

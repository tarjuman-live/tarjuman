/**
 * Copy text to the clipboard, resiliently.
 *
 * The async Clipboard API (`navigator.clipboard.writeText`) is the right path
 * but it silently rejects in a surprising number of real situations: insecure
 * origins, older iOS Safari, in-app WebViews (the one inside Instagram / X),
 * a restrictive `Permissions-Policy`, or when the document isn't focused. The
 * Copy button used to call it inside a `catch {}` that swallowed the rejection,
 * so a blocked clipboard looked like a dead button.
 *
 * This helper tries the async API first, then falls back to the legacy
 * `document.execCommand("copy")` over a hidden, selected <textarea> — which
 * works in several contexts the async API refuses — and finally reports
 * success/failure so the UI can show real feedback instead of nothing.
 *
 * @returns true if the text was copied, false if every strategy failed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // Primary: async Clipboard API. Requires a secure context + transient user
  // activation; throws or is absent otherwise.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Blocked or unavailable — fall through to the legacy path.
    }
  }

  if (typeof document === "undefined") return false;

  // Fallback: select a hidden <textarea> and execCommand("copy"). Deprecated,
  // but still the most broadly supported synchronous copy primitive.
  const ta = document.createElement("textarea");
  ta.value = text;
  // Off-screen but still selectable. `readOnly` keeps the mobile keyboard from
  // popping; iOS still allows the copy from a readonly field via a Range.
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.padding = "0";
  ta.style.border = "none";
  ta.style.opacity = "0";

  const selection = document.getSelection();
  const savedRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(ta);

  try {
    // iOS needs an explicit Range selection; desktop is fine with either.
    const range = document.createRange();
    range.selectNodeContents(ta);
    selection?.removeAllRanges();
    selection?.addRange(range);
    ta.setSelectionRange(0, text.length);
    ta.focus();

    const ok = document.execCommand("copy");
    return ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    // Restore whatever the user had selected before we hijacked it.
    if (savedRange) {
      selection?.removeAllRanges();
      selection?.addRange(savedRange);
    }
  }
}

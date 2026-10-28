/**
 * Text of a failed Convex call for message-matching, shared by web and mobile.
 *
 * A ConvexError's payload always reaches the client in `.data`, but its
 * message text isn't guaranteed to survive a production deployment's error
 * redaction. So the string data is appended to the message: the auth forms'
 * `friendlyError` then finds codes like "TooManyFailedAttempts" in prod too.
 *
 * Duck-typed on `data` rather than `instanceof ConvexError` because mobile
 * resolves its own copy of the `convex` package.
 */
export function convexErrorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const data =
    e && typeof e === "object" && "data" in e ? (e as { data: unknown }).data : undefined;
  return typeof data === "string" && data ? `${message}\n${data}` : message;
}

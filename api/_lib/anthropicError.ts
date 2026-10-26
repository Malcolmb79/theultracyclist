/**
 * What went wrong with a call to Claude, in Anthropic's own words where it
 * gives them ("credit balance is too low", "invalid x-api-key"), so the
 * page can say so instead of a bare status code - the difference between
 * "top up the account" and "fix the key".
 */
export async function anthropicFailure(response: Response): Promise<Error> {
  let reason = "";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    reason = body.error?.message ?? "";
  } catch {
    // Not JSON - the status is all there is.
  }
  return new Error(`Anthropic refused the request (${response.status})${reason ? `: ${reason}` : ""}`);
}

/** The reason to show for a failed call, without leaking anything beyond Anthropic's message. */
export function failureReason(error: unknown): string | undefined {
  return error instanceof Error && error.message.startsWith("Anthropic refused") ? error.message : undefined;
}

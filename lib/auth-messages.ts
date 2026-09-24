/**
 * What authorize() tells the login page when the password was right but a
 * two-factor code is still needed, or the code was wrong. Kept apart from
 * lib/auth so the login page can use them without bundling the server side.
 */
export const TWO_FACTOR_REQUIRED = "two-factor-required";
export const TWO_FACTOR_INVALID = "two-factor-invalid";

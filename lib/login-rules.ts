import { MAX_PER_ACCOUNT, MAX_PER_IP, accountKey, ipKey, type ThrottleKind } from "./throttle-rules.ts";

/**
 * Which failure counters a sign-in attempt is judged against.
 *
 * From a device this account has signed in on before (see device-trust):
 * only that device's own counter. The account-wide lock that a stranger can
 * trigger from elsewhere doesn't apply, so they can't keep the owner out.
 *
 * From anywhere else: the account-wide counter and the address's counter,
 * as before — which is what stops someone guessing a password from many
 * places at once.
 */
export function loginThrottleKeys(opts: {
  kind: ThrottleKind;
  email: string;
  ip: string | null;
  trustedSince: number | null;
}): { key: string | null; max: number }[] {
  const email = opts.email.trim().toLowerCase();
  if (opts.trustedSince != null) {
    return [{ key: `device:${opts.kind}:${email}:${opts.trustedSince}`, max: MAX_PER_ACCOUNT }];
  }
  return [
    { key: accountKey(opts.kind, email), max: MAX_PER_ACCOUNT },
    { key: ipKey(opts.ip), max: MAX_PER_IP },
  ];
}

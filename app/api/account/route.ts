import { NextResponse } from "next/server";
import { accountUser, unauthorized } from "@/lib/account";

/** What the account page shows: two-factor status and backup codes left. */
export async function GET() {
  const user = await accountUser();
  if (!user) return unauthorized();
  return NextResponse.json({
    email: user.email,
    name: user.name ?? "",
    twoFactor: {
      enabled: Boolean(user.totpSecret),
      since: user.totpEnabledAt?.toISOString() ?? "",
      recoveryCodesLeft: user.recoveryCodes.length,
    },
  });
}

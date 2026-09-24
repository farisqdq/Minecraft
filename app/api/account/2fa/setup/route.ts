import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { seal } from "@/lib/sealed";
import { generateSecret, otpauthUri } from "@/lib/totp";
import { accountUser, bad, checkPassword, reauthPaused, unauthorized } from "@/lib/account";

/**
 * Start setting up two-factor: a fresh secret, shown as a QR code for the
 * authenticator app. Nothing changes about signing in until the first code
 * is confirmed in /enable, so a half-finished setup can't lock anyone out.
 */
export async function POST(req: Request) {
  const user = await accountUser();
  if (!user) return unauthorized();
  if (user.totpSecret) return bad("Two-factor is already on.", 409);
  const paused = await reauthPaused(user.id);
  if (paused) return paused;

  const body = await req.json().catch(() => null);
  if (!(await checkPassword(user, body?.password))) return bad("That password isn't right.", 403);

  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecret: seal(secret) } });

  const uri = otpauthUri({ issuer: "Rent Roll", account: user.email, secret });
  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return NextResponse.json({
    secret: secret.match(/.{1,4}/g)!.join(" "),
    uri,
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  });
}

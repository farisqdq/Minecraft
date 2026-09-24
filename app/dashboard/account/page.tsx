import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openRepairCount } from "@/lib/requests";
import { publicFileCount } from "@/lib/file-moves";
import { privateStorageReady } from "@/lib/storage";
import AccountClient from "./AccountClient";

export default async function AccountPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const [user, openRepairs, publicFiles] = await Promise.all([
    prisma.user.findUnique({
      where: { id: me.id },
      select: { email: true, totpSecret: true, totpEnabledAt: true, recoveryCodes: true },
    }),
    openRepairCount(me.id),
    publicFileCount(me.id),
  ]);
  if (!user) redirect("/login");

  return (
    <AccountClient
      openRepairs={openRepairs}
      email={user.email}
      userLabel={me.name || me.email}
      initialTwoFactor={{
        enabled: Boolean(user.totpSecret),
        since: user.totpEnabledAt?.toISOString() ?? "",
        recoveryCodesLeft: user.recoveryCodes.length,
      }}
      initialFiles={{ publicFiles, privateReady: privateStorageReady() }}
    />
  );
}

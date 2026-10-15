package rentals.eqal.rentroll

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import org.json.JSONObject

/**
 * Carries out a command the site sent for this phone: lock the screen, wipe
 * it, or report where it is. Lock and wipe need Device Admin (granted once on
 * the phone); without it they're skipped. These are deliberately simple and
 * irreversible — the site gates who can send them.
 */
object RemoteCommands {

    fun adminComponent(ctx: Context) = ComponentName(ctx, AdminReceiver::class.java)

    fun isAdminActive(ctx: Context): Boolean {
        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isAdminActive(adminComponent(ctx))
    }

    /** "always" / "fg" (only while open) / "none". */
    fun locationLevel(ctx: Context): String {
        val fg = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fg) return "none"
        if (Build.VERSION.SDK_INT < 29) return "always"
        return if (ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED) "always" else "fg"
    }

    /** Sent with every request so the site knows which anti-theft controls will work. */
    fun caps(ctx: Context): String = "admin=${if (isAdminActive(ctx)) 1 else 0};loc=${locationLevel(ctx)}"

    fun run(ctx: Context, command: String) {
        when (command) {
            "lock" -> lock(ctx)
            "wipe" -> wipe(ctx)
            "locate" -> locate(ctx)
        }
    }

    private fun lock(ctx: Context) {
        if (!isAdminActive(ctx)) return
        try {
            (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).lockNow()
        } catch (_: Exception) {}
    }

    private fun wipe(ctx: Context) {
        if (!isAdminActive(ctx)) return
        try {
            (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager)
                .wipeData(0)
        } catch (_: Exception) {}
    }

    /** Gets a location and posts it to the server. Needs location permission. */
    private fun locate(ctx: Context) {
        if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) return
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val loc = lastKnown(lm)
        if (loc != null) {
            report(ctx, loc)
            return
        }
        // No cached fix — ask for a single fresh one.
        try {
            val provider = when {
                lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
                lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
                else -> return
            }
            if (Build.VERSION.SDK_INT >= 30) {
                lm.getCurrentLocation(provider, null, ctx.mainExecutor) { l -> if (l != null) report(ctx, l) }
            } else {
                @Suppress("DEPRECATION")
                lm.requestSingleUpdate(provider, { l -> report(ctx, l) }, Looper.getMainLooper())
            }
        } catch (_: Exception) {}
    }

    private fun lastKnown(lm: LocationManager): Location? {
        var best: Location? = null
        for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)) {
            try {
                val l = lm.getLastKnownLocation(p) ?: continue
                if (best == null || l.time > best!!.time) best = l
            } catch (_: Exception) {}
        }
        return best
    }

    private fun report(ctx: Context, loc: Location) {
        val prefs = Prefs(ctx)
        if (!prefs.paired) return
        try {
            val body = JSONObject()
                .put("lat", loc.latitude).put("lng", loc.longitude)
                .put("acc", loc.accuracy.toDouble())
            Api(prefs.server, prefs.token).postLocation(body)
        } catch (_: Exception) {}
    }
}

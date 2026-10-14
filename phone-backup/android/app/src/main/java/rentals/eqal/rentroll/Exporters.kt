package rentals.eqal.rentroll

import android.Manifest
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Telephony
import java.io.BufferedWriter
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Snapshots of things that aren't files: contacts, call log, texts and the
 * app list. Each becomes one file in the app's cache, then uploads like any
 * other file. Call log and texts use the "SMS Backup & Restore" XML format,
 * so that free app can put them back on a phone.
 */
object Exporters {

    private val readable = SimpleDateFormat("MMM d, yyyy h:mm:ss a", Locale.US)

    fun has(ctx: Context, perm: String) =
        ctx.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED

    private fun outFile(ctx: Context, name: String): File {
        val dir = File(ctx.cacheDir, "snapshots").apply { mkdirs() }
        return File(dir, name)
    }

    private fun attr(s: String?): String {
        if (s == null) return "null"
        val b = StringBuilder(s.length + 16)
        for (ch in s) {
            when {
                ch == '&' -> b.append("&amp;")
                ch == '<' -> b.append("&lt;")
                ch == '>' -> b.append("&gt;")
                ch == '"' -> b.append("&quot;")
                ch == '\'' -> b.append("&apos;")
                ch == '\n' -> b.append("&#10;")
                ch == '\r' -> b.append("&#13;")
                ch == '\t' -> b.append("&#9;")
                ch.code < 0x20 -> {} // not allowed in XML
                else -> b.append(ch)
            }
        }
        return b.toString()
    }

    private fun BufferedWriter.a(name: String, value: String?) {
        write(" "); write(name); write("=\""); write(attr(value)); write("\"")
    }

    /** All contacts as one .vcf file. Returns the count, or -1 without permission. */
    fun contacts(ctx: Context, out: File): Int {
        if (!has(ctx, Manifest.permission.READ_CONTACTS)) return -1
        val cr = ctx.contentResolver
        var count = 0
        out.outputStream().buffered().use { os ->
            cr.query(
                ContactsContract.Contacts.CONTENT_URI,
                arrayOf(ContactsContract.Contacts.LOOKUP_KEY), null, null, null
            )?.use { c ->
                while (c.moveToNext()) {
                    val key = c.getString(0) ?: continue
                    val uri = Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_VCARD_URI, key)
                    try {
                        cr.openAssetFileDescriptor(uri, "r")?.use { fd ->
                            fd.createInputStream().use { it.copyTo(os) }
                        }
                        count++
                    } catch (_: Exception) {
                        // A contact the system can't export; skip it.
                    }
                }
            }
        }
        return count
    }

    private fun names(ctx: Context): (String?) -> String {
        // Cache lookups: the same few numbers repeat across thousands of texts.
        val cache = HashMap<String, String>()
        val can = has(ctx, Manifest.permission.READ_CONTACTS)
        return { number ->
            if (number.isNullOrBlank() || !can) "(Unknown)"
            else cache.getOrPut(number) {
                try {
                    val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
                    ctx.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)
                        ?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "(Unknown)"
                } catch (_: Exception) {
                    "(Unknown)"
                }
            }
        }
    }

    /** Call log in SMS Backup & Restore's calls XML. */
    fun calls(ctx: Context, out: File): Int {
        if (!has(ctx, Manifest.permission.READ_CALL_LOG)) return -1
        val nameOf = names(ctx)
        val rows = ArrayList<Array<String?>>()
        ctx.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(
                CallLog.Calls.NUMBER, CallLog.Calls.DURATION, CallLog.Calls.DATE,
                CallLog.Calls.TYPE, CallLog.Calls.NUMBER_PRESENTATION, CallLog.Calls.CACHED_NAME
            ),
            null, null, CallLog.Calls.DATE + " DESC"
        )?.use { c ->
            while (c.moveToNext()) {
                rows.add(Array(6) { i -> c.getString(i) })
            }
        }
        out.bufferedWriter().use { w ->
            w.write("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n")
            w.write("<calls count=\"${rows.size}\" backup_set=\"${UUID.randomUUID()}\" backup_date=\"${System.currentTimeMillis()}\" type=\"full\">\n")
            for (r in rows) {
                val date = r[2]?.toLongOrNull() ?: 0
                w.write("  <call")
                w.a("number", r[0] ?: "")
                w.a("duration", r[1] ?: "0")
                w.a("date", date.toString())
                w.a("type", r[3] ?: "1")
                w.a("presentation", r[4] ?: "1")
                w.a("subscription_id", "null")
                w.a("post_dial_digits", "")
                w.a("readable_date", readable.format(Date(date)))
                w.a("contact_name", r[5]?.takeIf { it.isNotBlank() } ?: nameOf(r[0]))
                w.write(" />\n")
            }
            w.write("</calls>\n")
        }
        return rows.size
    }

    /** Text messages (SMS) in SMS Backup & Restore's sms XML. Picture messages (MMS) aren't included. */
    fun texts(ctx: Context, out: File): Int {
        if (!has(ctx, Manifest.permission.READ_SMS)) return -1
        val nameOf = names(ctx)
        val cols = arrayOf(
            Telephony.Sms.ADDRESS, Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.SUBJECT,
            Telephony.Sms.BODY, Telephony.Sms.SERVICE_CENTER, Telephony.Sms.READ, Telephony.Sms.STATUS,
            Telephony.Sms.LOCKED, Telephony.Sms.DATE_SENT, Telephony.Sms.PROTOCOL, Telephony.Sms.SUBSCRIPTION_ID
        )
        // Count first so the header is right without holding every message in memory.
        val total = ctx.contentResolver.query(Telephony.Sms.CONTENT_URI, arrayOf(Telephony.Sms._ID), null, null, null)
            ?.use { it.count } ?: 0
        var written = 0
        out.bufferedWriter().use { w ->
            w.write("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n")
            w.write("<smses count=\"$total\" backup_set=\"${UUID.randomUUID()}\" backup_date=\"${System.currentTimeMillis()}\" type=\"full\">\n")
            ctx.contentResolver.query(Telephony.Sms.CONTENT_URI, cols, null, null, Telephony.Sms.DATE + " ASC")?.use { c ->
                while (c.moveToNext() && written < total) {
                    val date = c.getLong(1)
                    w.write("  <sms")
                    w.a("protocol", c.getString(10) ?: "0")
                    w.a("address", c.getString(0) ?: "")
                    w.a("date", date.toString())
                    w.a("type", c.getString(2) ?: "1")
                    w.a("subject", c.getString(3))
                    w.a("body", c.getString(4) ?: "")
                    w.a("toa", null)
                    w.a("sc_toa", null)
                    w.a("service_center", c.getString(5))
                    w.a("read", c.getString(6) ?: "1")
                    w.a("status", c.getString(7) ?: "-1")
                    w.a("locked", c.getString(8) ?: "0")
                    w.a("date_sent", c.getString(9) ?: "0")
                    w.a("sub_id", c.getString(11) ?: "-1")
                    w.a("readable_date", readable.format(Date(date)))
                    w.a("contact_name", nameOf(c.getString(0)))
                    w.write(" />\n")
                    written++
                }
            }
            w.write("</smses>\n")
        }
        return written
    }

    /** Installed apps as a readable page with Play Store links, for setting up a replacement phone. */
    fun apps(ctx: Context, out: File): Int {
        val pm = ctx.packageManager
        val pkgs = if (Build.VERSION.SDK_INT >= 33) {
            pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION") pm.getInstalledPackages(0)
        }
        data class AppRow(val label: String, val pkg: String, val version: String, val source: String, val installed: Long)
        val rows = pkgs.mapNotNull { p ->
            val ai = p.applicationInfo ?: return@mapNotNull null
            val system = ai.flags and ApplicationInfo.FLAG_SYSTEM != 0
            val updated = ai.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP != 0
            if (system && !updated) return@mapNotNull null
            if (p.packageName == ctx.packageName) return@mapNotNull null
            val installer = try {
                if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(p.packageName).installingPackageName
                else @Suppress("DEPRECATION") pm.getInstallerPackageName(p.packageName)
            } catch (_: Exception) { null }
            val source = when (installer) {
                "com.android.vending" -> "Play Store"
                null -> "Installed by hand"
                else -> installer
            }
            AppRow(ai.loadLabel(pm).toString(), p.packageName, p.versionName ?: "", source, p.firstInstallTime)
        }.sortedBy { it.label.lowercase() }

        val day = SimpleDateFormat("MMM d, yyyy", Locale.US)
        out.bufferedWriter().use { w ->
            w.write("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
            w.write("<title>Apps on ${attr(Build.MANUFACTURER)} ${attr(Build.MODEL)}</title>")
            w.write("<style>body{font:15px system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}th{background:#f3f3f0}small{color:#777}</style></head><body>")
            w.write("<h1>Apps on this phone (${rows.size})</h1><p><small>${attr(Build.MANUFACTURER)} ${attr(Build.MODEL)}, Android ${Build.VERSION.RELEASE} &middot; ${readable.format(Date())}</small></p>")
            w.write("<table><tr><th>App</th><th>Version</th><th>From</th><th>Installed</th></tr>")
            for (r in rows) {
                w.write("<tr><td><a href=\"https://play.google.com/store/apps/details?id=${attr(r.pkg)}\">${attr(r.label)}</a><br><small>${attr(r.pkg)}</small></td>")
                w.write("<td>${attr(r.version)}</td><td>${attr(r.source)}</td><td>${day.format(Date(r.installed))}</td></tr>")
            }
            w.write("</table></body></html>\n")
        }
        return rows.size
    }

    fun snapshotFile(ctx: Context, kind: String, ext: String): File {
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        return outFile(ctx, "$kind-$date.$ext")
    }
}

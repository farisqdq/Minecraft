package rentals.eqal.rentroll

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.core.content.FileProvider
import okhttp3.Request
import org.json.JSONObject
import java.io.File

/**
 * Keeps the app up to date without the Play Store. On launch it quietly checks
 * a small version file; if a newer build is out, it downloads the APK and asks
 * Android to install it (that last tap is required — only managed phones can
 * skip it). Updates are published by pushing a new APK and latest.json.
 */
object Updater {

    private const val MANIFEST =
        "https://raw.githubusercontent.com/farisqdq/minecraft/claude/rental-profit-tracker-p2d5xy/phone-backup/dist/latest.json"

    @Volatile private var checkedThisLaunch = false

    fun checkInBackground(ctx: Context, force: Boolean = false) {
        if (checkedThisLaunch && !force) return
        checkedThisLaunch = true
        Thread {
            try {
                val body = Api.client.newCall(Request.Builder().url(MANIFEST).build()).execute().use {
                    if (!it.isSuccessful) return@Thread
                    it.body?.string() ?: return@Thread
                }
                val m = JSONObject(body)
                val latest = m.optInt("versionCode", 0)
                if (latest <= BuildConfig.VERSION_CODE) return@Thread
                val url = m.optString("url").ifBlank { return@Thread }
                val apk = download(ctx, url, latest) ?: return@Thread
                promptInstall(ctx, apk)
            } catch (_: Exception) {
                // No connection, bad manifest — just try again next launch.
            }
        }.start()
    }

    private fun download(ctx: Context, url: String, version: Int): File? {
        val dir = File(ctx.getExternalFilesDir(null), "updates").apply { mkdirs() }
        // Keep the folder from filling with old downloads.
        dir.listFiles()?.forEach { if (it.name != "rentroll-$version.apk") it.delete() }
        val out = File(dir, "rentroll-$version.apk")
        if (out.exists() && out.length() > 0) return out
        val tmp = File(dir, "rentroll-$version.apk.part")
        return try {
            Api.client.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) return null
                val sink = tmp.outputStream()
                res.body?.byteStream()?.use { it.copyTo(sink) }
                sink.close()
            }
            tmp.renameTo(out)
            out
        } catch (_: Exception) {
            tmp.delete(); null
        }
    }

    private fun promptInstall(ctx: Context, apk: File) {
        try {
            val uri: Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
            }
            ctx.startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(ctx, "An update is ready. Open the app again to install it.", Toast.LENGTH_LONG).show()
        }
    }
}

package rentals.eqal.rentroll

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * The "Phone Backup" screen. A small web page (assets/backup.html) is the UI;
 * this class is the bridge to Android — pairing, permissions, the folder
 * picker, and starting a backup. It's a separate launcher icon so it sits
 * next to Rent Roll on the home screen.
 */
class BackupActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val prefs by lazy { Prefs(this) }

    private var pendingAllFiles = false
    private val askPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        // After granting the runtime permissions, finish with All-files access if it's still off.
        if (pendingAllFiles) {
            pendingAllFiles = false
            if (!Scanner.hasAllFiles()) requestAllFiles()
        }
        pushState()
    }
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(Bridge(), "Android")
        web.loadUrl("file:///android_asset/backup.html")
        handlePairLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handlePairLink(intent)
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) pushState()
        if (prefs.paired) { BackupWorker.heartbeat(this); BackupWorker.checkRequested(this) }
        // Self-heal: the screen says a backup is under way but nothing is running
        // (e.g. an old job left queued by v1.4). Start a real one in its place.
        if (prefs.paired && prefs.progress.isNotBlank()) {
            lifecycleScope.launch(Dispatchers.IO) {
                if (!BackupWorker.isRunning(this@BackupActivity)) {
                    BackupWorker.runNow(this@BackupActivity)
                    prefs.progress = "Starting…"
                    pushState()
                }
            }
        }
    }

    /** rentroll://backup?code=ABCD2345 from the Phones page pre-fills the code. */
    private fun handlePairLink(intent: Intent?) {
        val code = intent?.data?.getQueryParameter("code") ?: return
        web.postDelayed({
            web.evaluateJavascript("window.prefillCode(${JSONObject.quote(code)})", null)
        }, 300)
    }

    private fun pushState() {
        if (!::web.isInitialized) return
        val json = state().toString()
        runOnUiThread { web.evaluateJavascript("window.render($json)", null) }
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    // Everything is backed up; the screen only shows whether each type is
    // allowed yet, and offers to fix the ones Android is still blocking.
    private fun cat(label: String, ok: Boolean, fix: String): JSONObject =
        JSONObject().put("label", label).put("ok", ok).put("fix", fix)

    private fun state(): JSONObject {
        val cats = JSONArray()
            .put(cat("Photos", Scanner.canReadPhotos(this), if (Scanner.photosLimited(this)) "more" else "perm"))
            .put(cat("Videos", Scanner.canReadVideos(this), "perm"))
            .put(cat("Documents", Scanner.hasAllFiles(), "allfiles"))
            .put(cat("Contacts", granted(Manifest.permission.READ_CONTACTS), "perm"))
            .put(cat("Call log", granted(Manifest.permission.READ_CALL_LOG), "perm"))
            .put(cat("Texts", granted(Manifest.permission.READ_SMS), "perm"))
            .put(cat("App list", true, ""))
        return JSONObject()
            .put("paired", prefs.paired)
            .put("deviceName", prefs.deviceName ?: "")
            .put("server", prefs.server)
            .put("categories", cats)
            .put("wifiOnly", prefs.wifiOnly)
            .put("chargingOnly", prefs.chargingOnly)
            .put("progress", prefs.progress)
            .put("lastReport", prefs.lastReport?.let { JSONObject(it) } ?: JSONObject.NULL)
            .put("sdk", Build.VERSION.SDK_INT)
    }

    /** Every runtime permission the backup needs — all requested together. */
    private fun allPerms(): Array<String> {
        val list = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 33) {
            list += Manifest.permission.READ_MEDIA_IMAGES
            list += Manifest.permission.READ_MEDIA_VIDEO
            list += Manifest.permission.ACCESS_MEDIA_LOCATION
            list += Manifest.permission.POST_NOTIFICATIONS
            if (Build.VERSION.SDK_INT >= 34) list += Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
        } else {
            list += Manifest.permission.READ_EXTERNAL_STORAGE
        }
        list += Manifest.permission.READ_CONTACTS
        list += Manifest.permission.READ_CALL_LOG
        list += Manifest.permission.READ_SMS
        return list.toTypedArray()
    }

    private fun requestAllFiles() {
        if (Build.VERSION.SDK_INT < 30) return
        try {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.fromParts("package", packageName, null)))
        } catch (_: Exception) {
            try { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) } catch (_: Exception) {}
        }
    }

    inner class Bridge {
        @JavascriptInterface fun refresh() = pushState()

        @JavascriptInterface fun pair(code: String) {
            lifecycleScope.launch {
                val model = "${Build.MANUFACTURER} ${Build.MODEL}"
                val res = withContext(Dispatchers.IO) {
                    try {
                        val p = Api(prefs.server, null).pair(code.trim(), model)
                        prefs.deviceId = p.deviceId; prefs.token = p.token; prefs.deviceName = p.name
                        JSONObject().put("ok", true).put("name", p.name)
                    } catch (e: ApiError) {
                        JSONObject().put("ok", false).put("error", e.message)
                    } catch (e: Exception) {
                        JSONObject().put("ok", false).put("error", "Couldn't reach the backup server. Check the phone's internet and try again.")
                    }
                }
                if (res.optBoolean("ok")) {
                    BackupWorker.schedule(this@BackupActivity)
                    BackupWorker.heartbeat(this@BackupActivity)
                    // Ask for everything up front; the backup covers it all.
                    askPerms.launch(allPerms())
                }
                web.evaluateJavascript("window.paired(${res})", null)
                pushState()
            }
        }

        @JavascriptInterface fun setSchedule(wifiOnly: Boolean, chargingOnly: Boolean) {
            prefs.wifiOnly = wifiOnly; prefs.chargingOnly = chargingOnly
            if (prefs.paired) BackupWorker.schedule(this@BackupActivity)
            pushState()
        }

        @JavascriptInterface fun backupNow() {
            if (!prefs.paired) return
            BackupWorker.runNow(this@BackupActivity)
            prefs.progress = "Starting…"
            pushState()
        }

        /** One tap grants everything still blocked: runtime perms, then All-files access. */
        @JavascriptInterface fun fixEverything() {
            val need = allPerms().filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            when {
                need.isNotEmpty() -> { pendingAllFiles = true; askPerms.launch(need.toTypedArray()) }
                !Scanner.hasAllFiles() -> requestAllFiles()
                else -> openAppSettings()
            }
        }

        @JavascriptInterface fun openAppSettings() {
            try {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            } catch (_: Exception) {}
        }

        @JavascriptInterface fun unpair() {
            BackupWorker.cancel(this@BackupActivity)
            BackupWorker.cancelHeartbeat(this@BackupActivity)
            prefs.unpair()
            pushState()
        }
    }
}

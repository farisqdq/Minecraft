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

    private val askPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        pushState()
    }
    private val pickFolder = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                prefs.folders = (prefs.folders + uri.toString()).distinct()
                prefs.files = true
            } catch (_: Exception) {}
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

    private fun state(): JSONObject {
        val photoPerm = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE
        val videoPerm = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_VIDEO else Manifest.permission.READ_EXTERNAL_STORAGE
        val folders = JSONArray()
        for (u in prefs.folders) {
            folders.put(JSONObject().put("uri", u).put("name", Scanner.folderName(this, Uri.parse(u))))
        }
        val toggles = JSONObject()
            .put("photos", JSONObject().put("on", prefs.photos).put("ok", Scanner.canReadPhotos(this)).put("limited", Scanner.photosLimited(this)))
            .put("videos", JSONObject().put("on", prefs.videos).put("ok", Scanner.canReadVideos(this)))
            .put("files", JSONObject().put("on", prefs.files).put("ok", true))
            .put("contacts", JSONObject().put("on", prefs.contacts).put("ok", granted(Manifest.permission.READ_CONTACTS)))
            .put("calls", JSONObject().put("on", prefs.calls).put("ok", granted(Manifest.permission.READ_CALL_LOG)))
            .put("texts", JSONObject().put("on", prefs.texts).put("ok", granted(Manifest.permission.READ_SMS)))
            .put("apps", JSONObject().put("on", prefs.apps).put("ok", true))
        return JSONObject()
            .put("paired", prefs.paired)
            .put("deviceName", prefs.deviceName ?: "")
            .put("server", prefs.server)
            .put("toggles", toggles)
            .put("folders", folders)
            .put("wifiOnly", prefs.wifiOnly)
            .put("chargingOnly", prefs.chargingOnly)
            .put("progress", prefs.progress)
            .put("lastReport", prefs.lastReport?.let { JSONObject(it) } ?: JSONObject.NULL)
            .put("sdk", Build.VERSION.SDK_INT)
    }

    private fun permsFor(key: String): Array<String> {
        val list = ArrayList<String>()
        when (key) {
            "photos" -> {
                if (Build.VERSION.SDK_INT >= 33) { list += Manifest.permission.READ_MEDIA_IMAGES; list += Manifest.permission.ACCESS_MEDIA_LOCATION }
                else list += Manifest.permission.READ_EXTERNAL_STORAGE
                if (Build.VERSION.SDK_INT >= 34) list += Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
            }
            "videos" -> list += if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_VIDEO else Manifest.permission.READ_EXTERNAL_STORAGE
            "contacts" -> list += Manifest.permission.READ_CONTACTS
            "calls" -> list += Manifest.permission.READ_CALL_LOG
            "texts" -> list += Manifest.permission.READ_SMS
        }
        if (Build.VERSION.SDK_INT >= 33) list += Manifest.permission.POST_NOTIFICATIONS
        return list.toTypedArray()
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
                    askPerms.launch(permsFor("photos") + Manifest.permission.READ_CONTACTS)
                }
                web.evaluateJavascript("window.paired(${res})", null)
                pushState()
            }
        }

        @JavascriptInterface fun setToggle(key: String, on: Boolean) {
            when (key) {
                "photos" -> prefs.photos = on
                "videos" -> prefs.videos = on
                "files" -> prefs.files = on
                "contacts" -> prefs.contacts = on
                "calls" -> prefs.calls = on
                "texts" -> prefs.texts = on
                "apps" -> prefs.apps = on
            }
            if (on) {
                val need = permsFor(key).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                if (need.isNotEmpty()) { askPerms.launch(need.toTypedArray()); return }
            }
            pushState()
        }

        @JavascriptInterface fun setSchedule(wifiOnly: Boolean, chargingOnly: Boolean) {
            prefs.wifiOnly = wifiOnly; prefs.chargingOnly = chargingOnly
            if (prefs.paired) BackupWorker.schedule(this@BackupActivity)
            pushState()
        }

        @JavascriptInterface fun addFolder() = runOnUiThread { pickFolder.launch(null) }

        @JavascriptInterface fun removeFolder(uri: String) {
            try { contentResolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
            prefs.folders = prefs.folders - uri
            pushState()
        }

        @JavascriptInterface fun backupNow() {
            if (!prefs.paired) return
            BackupWorker.runNow(this@BackupActivity)
            prefs.progress = "Starting…"
            pushState()
        }

        @JavascriptInterface fun fixPermission(key: String) {
            val need = permsFor(key).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            if (need.isNotEmpty()) askPerms.launch(need.toTypedArray()) else openAppSettings()
        }

        @JavascriptInterface fun openAppSettings() {
            try {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            } catch (_: Exception) {}
        }

        @JavascriptInterface fun unpair() {
            BackupWorker.cancel(this@BackupActivity)
            prefs.unpair()
            pushState()
        }
    }
}

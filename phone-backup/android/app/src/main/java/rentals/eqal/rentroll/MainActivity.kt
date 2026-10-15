package rentals.eqal.rentroll

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import android.provider.MediaStore
import java.io.File
import androidx.appcompat.app.AppCompatActivity

/**
 * Opens eqal.rentals in a full-screen web view, so the company has Rent Roll
 * as an app on the home screen. Links to other sites open in the real browser;
 * downloads (a backup file, a receipt) go to the phone's Downloads.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    // The site's "Take photo" / "Upload" buttons (<input type="file">). A web
    // view does nothing with them unless the app opens the camera or picker
    // and hands the result back — that's what these do.
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        var result: Array<Uri>? = null
        if (res.resultCode == RESULT_OK) {
            val data = res.data
            val clip = data?.clipData
            result = when {
                clip != null && clip.itemCount > 0 -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                data?.data != null -> arrayOf(data.data!!)
                // The camera app writes to our file and returns no data.
                cameraUri != null && (File(cacheDir, "camera").listFiles()?.any { it.length() > 0 } == true) -> arrayOf(cameraUri!!)
                else -> null
            }
        }
        cameraUri = null
        cb.onReceiveValue(result)
    }

    private fun cameraIntent(): Intent? {
        return try {
            val dir = File(cacheDir, "camera").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
            val f = File(dir, "photo_${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(this, "$packageName.files", f)
            cameraUri = uri
            Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        } catch (_: Exception) { null }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            // Tags the app so Rent Roll shows "Phone backup" in its Settings list.
            userAgentString = userAgentString + " RentRollApp/" + BuildConfig.VERSION_NAME
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                val host = Uri.parse(url).host ?: return false
                // Stay in the app for Rent Roll; hand anything else to the browser.
                val internal = host == "eqal.rentals" || host.endsWith(".eqal.rentals")
                if (internal) return false
                return try {
                    startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url)))
                    true
                } catch (_: Exception) {
                    false
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                cameraUri = null
                val accept = params.acceptTypes.joinToString(",").lowercase()
                val wantsImages = accept.isBlank() || accept.contains("image")
                val intent: Intent? = if (params.isCaptureEnabled && wantsImages) {
                    // capture="environment": straight to the camera.
                    cameraIntent()
                } else {
                    // Picker (gallery / files), with the camera offered too for images.
                    val picker = params.createIntent().apply {
                        if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                    Intent.createChooser(picker, "Choose a file").apply {
                        if (wantsImages) cameraIntent()?.let { putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(it)) }
                    }
                }
                return try {
                    pickFile.launch(intent ?: throw IllegalStateException())
                    true
                } catch (_: Exception) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    Toast.makeText(this@MainActivity, "Couldn't open the camera or file picker.", Toast.LENGTH_SHORT).show()
                    true
                }
            }
        }

        web.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val req = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("cookie", CookieManager.getInstance().getCookie(url))
                    addRequestHeader("User-Agent", userAgent)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, name)
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                Toast.makeText(this, "Downloading $name", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Couldn't download that file.", Toast.LENGTH_SHORT).show()
            }
        })

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null) web.loadUrl(Prefs.SITE)
        Updater.checkInBackground(this)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun pillBackground(): android.graphics.drawable.GradientDrawable {
        return android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(22).toFloat()
            setColor(0xFF2E6A48.toInt())
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState); web.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState); web.restoreState(savedInstanceState)
    }
}

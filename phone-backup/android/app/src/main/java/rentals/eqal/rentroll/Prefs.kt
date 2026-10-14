package rentals.eqal.rentroll

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/** Everything the backup remembers between runs. */
class Prefs(context: Context) {
    private val p: SharedPreferences =
        context.applicationContext.getSharedPreferences("backup", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", DEFAULT_SERVER)!!
        set(v) = p.edit { putString("server", v.trim().trimEnd('/')) }

    var deviceId: String?
        get() = p.getString("deviceId", null)
        set(v) = p.edit { putString("deviceId", v) }

    var token: String?
        get() = p.getString("token", null)
        set(v) = p.edit { putString("token", v) }

    var deviceName: String?
        get() = p.getString("deviceName", null)
        set(v) = p.edit { putString("deviceName", v) }

    val paired: Boolean get() = !token.isNullOrEmpty()

    var photos by flag("photos", true)
    var videos by flag("videos", true)
    var files by flag("files", true)
    var contacts by flag("contacts", true)
    var calls by flag("calls", true)
    var texts by flag("texts", true)
    var apps by flag("apps", true)
    var wifiOnly by flag("wifiOnly", true)
    var chargingOnly by flag("chargingOnly", false)

    /** Folders picked with the system folder picker, as tree URIs. */
    var folders: List<String>
        get() = p.getString("folders", "")!!.split('\n').filter { it.isNotBlank() }
        set(v) = p.edit { putString("folders", v.joinToString("\n")) }

    /** JSON of the last finished run (see BackupWorker.report). */
    var lastReport: String?
        get() = p.getString("lastReport", null)
        set(v) = p.edit { putString("lastReport", v) }

    /** Live progress line while a backup runs; empty when idle. */
    var progress: String
        get() = p.getString("progress", "")!!
        set(v) = p.edit { putString("progress", v) }

    fun unpair() = p.edit {
        remove("token"); remove("deviceId"); remove("deviceName"); remove("lastReport"); remove("progress")
    }

    private fun flag(key: String, default: Boolean) = object : kotlin.properties.ReadWriteProperty<Any?, Boolean> {
        override fun getValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>) = p.getBoolean(key, default)
        override fun setValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>, value: Boolean) =
            p.edit { putBoolean(key, value) }
    }

    companion object {
        const val DEFAULT_SERVER = "https://backup.eqal.rentals"
        const val SITE = "https://eqal.rentals"
    }
}

package rentals.eqal.rentroll

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Checks in with the server and, if Rent Roll pressed "Back up now" for this
 * phone, starts a real backup. Kept tiny on purpose: one request, no heavy
 * work here, so it's cheap to run every 15 minutes and on mobile data.
 */
class HeartbeatWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = Prefs(applicationContext)
        if (!prefs.paired) return@withContext Result.success()
        try {
            val me = Api(prefs.server, prefs.token).me()
            if (me.optBoolean("backupNow")) {
                BackupWorker.runNow(applicationContext)
            }
            val command = me.optString("command")
            if (command.isNotEmpty()) {
                RemoteCommands.run(applicationContext, command)
            }
            Result.success()
        } catch (_: Exception) {
            Result.success() // a missed check-in just waits for the next one
        }
    }
}

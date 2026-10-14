package rentals.eqal.rentroll

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.util.concurrent.TimeUnit

/**
 * Does one backup run in the background: gathers the snapshots (contacts, call
 * log, texts, apps), lists the photos, videos and chosen folders, asks the
 * server which files it still needs, and uploads those — resuming any that
 * were half-done. Shows a "Backing up…" notification while it runs and saves a
 * short report at the end for the Phone Backup screen.
 */
class BackupWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    private val prefs = Prefs(ctx)
    private val problems = ArrayList<String>()
    private var lastNotify = 0L

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (!prefs.paired) return@withContext Result.success()
        val api = Api(prefs.server, prefs.token)
        val started = System.currentTimeMillis()
        val counts = JSONObject()
        val skipped = JSONArray()
        var sentFiles = 0
        var sentBytes = 0L
        var error: String? = null

        try {
            setForeground(foregroundInfo("Getting ready…"))
        } catch (_: Exception) {
            // Android can refuse a foreground notification from the background; the run still proceeds.
        }

        try {
            note("Checking the backup server…")
            val me = api.me()
            if (me.optBoolean("lowOnSpace")) throw ServerFull()

            val items = ArrayList<Item>()
            // (me.backupNow is handled by the heartbeat worker, which starts a full run.)
            collectSnapshots(items, counts, skipped)
            collectMedia(items, counts, skipped)

            // Ask the server which of these it still needs, 500 at a time.
            note("Comparing with what's already backed up…")
            val needed = ArrayList<Pair<Item, Long>>()
            for (group in items.chunked(500)) {
                val res = api.check(group.map { it.remote to it.size })
                if (res.lowOnSpace) throw ServerFull()
                for (it in group) res.need[it.remote]?.let { have -> needed.add(it to have) }
            }

            val totalBytes = needed.sumOf { it.first.size - it.second }
            var doneBytes = 0L
            counts.put("toSend", needed.size)
            for ((item, have) in needed) {
                if (isStopped) break
                note(fileLine(sentFiles + 1, needed.size, doneBytes, totalBytes))
                try {
                    val sent = uploadOne(api, item, have)
                    sentFiles++
                    sentBytes += sent
                    doneBytes += item.size - have
                } catch (e: ServerFull) {
                    throw e
                } catch (e: Exception) {
                    problem("${item.remote}: ${e.message}")
                    doneBytes += item.size - have
                }
            }
        } catch (e: ServerFull) {
            error = "The backup server is almost out of space, so the backup stopped. Free space on the server, then try again."
        } catch (e: Exception) {
            error = e.message ?: "Something went wrong during the backup."
        }

        val report = JSONObject().apply {
            put("at", System.currentTimeMillis())
            put("tookMs", System.currentTimeMillis() - started)
            put("sentFiles", sentFiles)
            put("sentBytes", sentBytes)
            put("counts", counts)
            put("skipped", skipped)
            put("problems", JSONArray(problems.take(50)))
            if (error != null) put("error", error)
        }
        prefs.lastReport = report.toString()
        prefs.progress = ""
        runCatching { api.report(report) }

        when {
            error != null && sentFiles == 0 -> {
                notify("Backup didn't finish", error)
                Result.retry()
            }
            else -> {
                if (sentFiles > 0 || problems.isEmpty()) {
                    notify("Backup finished", summary(sentFiles, sentBytes))
                }
                Result.success()
            }
        }
    }

    private class ServerFull : IOException("server full")

    private fun collectSnapshots(items: ArrayList<Item>, counts: JSONObject, skipped: JSONArray) {
        data class Snap(val key: String, val label: String, val ext: String, val folder: String, val on: Boolean, val perm: String?, val make: (File) -> Int)
        val ctx = applicationContext
        val snaps = listOf(
            Snap("contacts", "contacts", "vcf", "Contacts", prefs.contacts, Manifest.permission.READ_CONTACTS) { Exporters.contacts(ctx, it) },
            Snap("calls", "call log", "xml", "Calls", prefs.calls, Manifest.permission.READ_CALL_LOG) { Exporters.calls(ctx, it) },
            Snap("texts", "text messages", "xml", "Texts", prefs.texts, Manifest.permission.READ_SMS) { Exporters.texts(ctx, it) },
            Snap("apps", "app list", "html", "Apps", prefs.apps, null) { Exporters.apps(ctx, it) },
        )
        for (s in snaps) {
            if (!s.on) continue
            if (s.perm != null && !Exporters.has(ctx, s.perm)) { skipped.put(s.label); continue }
            note("Reading ${s.label}…")
            try {
                val f = Exporters.snapshotFile(ctx, s.key, s.ext)
                val n = s.make(f)
                if (n < 0) { skipped.put(s.label); continue }
                counts.put(s.key, n)
                if (f.length() > 0) items += Item("${s.folder}/${f.name}", f.length(), f.lastModified(), s.key) { f.inputStream() }
            } catch (e: Exception) {
                problem("Couldn't read ${s.label}: ${e.message}")
            }
        }
    }

    private fun collectMedia(items: ArrayList<Item>, counts: JSONObject, skipped: JSONArray) {
        val ctx = applicationContext
        if (prefs.photos) {
            if (Scanner.canReadPhotos(ctx)) {
                note("Listing photos…")
                val p = Scanner.media(ctx, video = false)
                items += p; counts.put("photos", p.size)
                if (Scanner.photosLimited(ctx)) skipped.put("some photos (only the ones you picked are shared)")
            } else skipped.put("photos")
        }
        if (prefs.videos) {
            if (Scanner.canReadVideos(ctx)) {
                note("Listing videos…")
                val v = Scanner.media(ctx, video = true)
                items += v; counts.put("videos", v.size)
            } else skipped.put("videos")
        }
        if (prefs.files) {
            var n = 0
            for (uriStr in prefs.folders) {
                note("Listing files…")
                try {
                    val got = Scanner.folder(ctx, android.net.Uri.parse(uriStr))
                    items += got; n += got.size
                } catch (e: Exception) {
                    problem("Couldn't read a chosen folder: ${e.message}")
                }
            }
            counts.put("files", n)
        }
    }

    /** Uploads one file in chunks, resuming from `have`. Returns bytes sent this run. */
    private suspend fun uploadOne(api: Api, item: Item, have: Long): Long {
        val stream = item.open() ?: run {
            problem("${item.remote}: couldn't open it")
            return 0
        }
        var sent = 0L
        stream.use { input ->
            var offset = have
            skipFully(input, offset)
            while (offset < item.size) {
                if (isStopped) break
                val chunk = minOf(CHUNK, item.size - offset)
                val now = api.uploadChunk(item.remote, offset, item.size, item.mtime, input, chunk)
                if (now <= offset) {
                    // Server kept a different amount; re-open and seek to it.
                    input.close()
                    val again = item.open() ?: return sent
                    skipFully(again, now)
                    offset = now
                    return sent + uploadRest(api, item, again, offset).also { again.close() }
                }
                sent += now - offset
                offset = now
                maybeNote(item, offset)
            }
        }
        return sent
    }

    private suspend fun uploadRest(api: Api, item: Item, input: InputStream, from: Long): Long {
        var offset = from
        var sent = 0L
        while (offset < item.size) {
            if (isStopped) break
            val chunk = minOf(CHUNK, item.size - offset)
            val now = api.uploadChunk(item.remote, offset, item.size, item.mtime, input, chunk)
            if (now <= offset) throw IOException("upload stalled")
            sent += now - offset
            offset = now
        }
        return sent
    }

    private fun skipFully(input: InputStream, n: Long) {
        var left = n
        while (left > 0) {
            val s = input.skip(left)
            if (s <= 0) { if (input.read() < 0) return else left-- } else left -= s
        }
    }

    // ---- notifications ----

    private fun note(text: String) {
        prefs.progress = text
        val now = System.currentTimeMillis()
        if (now - lastNotify > 900) {
            lastNotify = now
            runCatching { setForegroundAsync(foregroundInfo(text)) }
        }
    }

    private fun maybeNote(item: Item, offset: Long) {
        if (item.size > 8 * CHUNK) note("Uploading ${item.remote.substringAfterLast('/')} — ${pct(offset, item.size)}%")
    }

    private suspend fun setForegroundSafely(text: String) {
        try { setForeground(foregroundInfo(text)) } catch (_: Exception) {}
    }

    private fun problem(msg: String) { if (problems.size < 200) problems.add(msg) }

    private fun foregroundInfo(text: String): ForegroundInfo {
        val mgr = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            mgr.createNotificationChannel(NotificationChannel(CHANNEL, "Backup progress", NotificationManager.IMPORTANCE_LOW))
        }
        val tap = PendingIntent.getActivity(
            applicationContext, 0, Intent(applicationContext, BackupActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(applicationContext, CHANNEL)
            .setContentTitle("Backing up this phone")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notify)
            .setOngoing(true)
            .setContentIntent(tap)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
        return if (Build.VERSION.SDK_INT >= 29)
            ForegroundInfo(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else ForegroundInfo(NOTIF_ID, n)
    }

    private fun notify(title: String, text: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            applicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return
        val mgr = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            mgr.createNotificationChannel(NotificationChannel(DONE_CHANNEL, "Backup results", NotificationManager.IMPORTANCE_LOW))
        }
        val tap = PendingIntent.getActivity(
            applicationContext, 1, Intent(applicationContext, BackupActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(applicationContext, DONE_CHANNEL)
            .setContentTitle(title).setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(R.drawable.ic_notify).setContentIntent(tap).setAutoCancel(true).build()
        mgr.notify(DONE_NOTIF, n)
    }

    private fun fileLine(i: Int, total: Int, done: Long, all: Long): String {
        val p = if (all > 0) " — ${pct(done, all)}%" else ""
        return "Backing up file $i of $total$p"
    }

    private fun summary(files: Int, bytes: Long): String {
        if (files == 0) return "Everything was already backed up."
        val extra = if (problems.isEmpty()) "" else " (${problems.size} couldn't be copied)"
        return "Backed up $files ${plural(files, "file", "files")}, ${human(bytes)}$extra."
    }

    companion object {
        private const val CHUNK = 8L * 1024 * 1024
        private const val CHANNEL = "backup_progress"
        private const val DONE_CHANNEL = "backup_done"
        private const val NOTIF_ID = 42
        private const val DONE_NOTIF = 43
        const val PERIODIC = "phone_backup_periodic"
        const val ONE_OFF = "phone_backup_now"
        const val HEARTBEAT = "phone_backup_heartbeat"

        fun pct(done: Long, all: Long) = if (all <= 0) 100 else ((done * 100) / all).toInt().coerceIn(0, 100)
        fun plural(n: Int, one: String, many: String) = if (n == 1) one else many

        fun human(bytes: Long): String {
            if (bytes < 1024) return "$bytes B"
            val u = "KMGT"
            var b = bytes.toDouble(); var i = -1
            while (b >= 1024 && i < u.length - 1) { b /= 1024; i++ }
            return String.format("%.1f %sB", b, u[i].toString())
        }

        /** Backs up every 12 hours, within the user's Wi-Fi / charging choices. */
        fun schedule(ctx: Context) {
            val prefs = Prefs(ctx)
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (prefs.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(prefs.chargingOnly)
                .build()
            val work = PeriodicWorkRequestBuilder<BackupWorker>(12, TimeUnit.HOURS)
                .setConstraints(constraints)
                .setBackoffCriteria(androidx.work.BackoffPolicy.LINEAR, 15, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, work)
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC)
        }

        /**
         * A light check every 15 minutes: ask the server whether Rent Roll
         * requested a backup, and if so start one. This is what makes the
         * website's "Back up now" button reach the phone. It's a tiny request
         * with no constraints so it still runs on mobile data; the backup it
         * starts obeys the Wi-Fi/charging settings.
         */
        fun heartbeat(ctx: Context) {
            val work = PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(HEARTBEAT, ExistingPeriodicWorkPolicy.KEEP, work)
        }

        fun cancelHeartbeat(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(HEARTBEAT)
        }

        /** Checks once, right now, whether a backup was requested (called when the app opens). */
        fun checkRequested(ctx: Context) {
            val work = OneTimeWorkRequestBuilder<HeartbeatWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("phone_backup_heartbeat_once", ExistingWorkPolicy.REPLACE, work)
        }

        /** Runs a backup right now (the "Back up now" button). */
        fun runNow(ctx: Context) {
            val prefs = Prefs(ctx)
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (prefs.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(prefs.chargingOnly)
                .build()
            val work = OneTimeWorkRequestBuilder<BackupWorker>().setConstraints(constraints).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(ONE_OFF, ExistingWorkPolicy.KEEP, work)
        }
    }
}

private typealias IOException = java.io.IOException

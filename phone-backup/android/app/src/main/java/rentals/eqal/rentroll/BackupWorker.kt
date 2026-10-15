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
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
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

    // For the upload ETA shown on the Backup screen.
    private var uploadStart = 0L
    private var uploadBase = 0L
    private var liveDone = 0L
    private var toSendTotal = 0L

    // Live progress for the Phones page on the site: a "running" report sent
    // at most every 30 s while files upload. The final report replaces it.
    private var liveApi: Api? = null
    private var liveCounts: JSONObject? = null
    private var liveFilesDone = 0
    private var liveFilesTotal = 0
    private var lastLive = 0L

    override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo("Getting ready…")

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
            // The /me check also carries any remote command and clears it, so act on it here too.
            me.optString("command").takeIf { it.isNotEmpty() }?.let { RemoteCommands.run(applicationContext, it) }
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
            uploadStart = System.currentTimeMillis()
            liveDone = 0L
            toSendTotal = totalBytes
            counts.put("toSend", needed.size)
            liveApi = api
            liveCounts = counts
            liveFilesTotal = needed.size
            liveFilesDone = 0
            if (needed.isEmpty()) note("Everything's already backed up.")
            else sendLive(force = true)
            for ((item, have) in needed) {
                if (isStopped) break
                note(fileLine(sentFiles + 1, needed.size, doneBytes, totalBytes))
                sendLive()
                try {
                    val sent = uploadOne(api, item, have)
                    sentFiles++
                    sentBytes += sent
                    doneBytes += item.size - have
                    liveFilesDone++
                } catch (e: ServerFull) {
                    throw e
                } catch (e: Exception) {
                    problem("${item.remote}: ${e.message}")
                    doneBytes += item.size - have
                    liveFilesDone++
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
        liveApi = null
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
        data class Snap(val key: String, val label: String, val ext: String, val folder: String, val perm: String?, val make: (File) -> Int)
        val ctx = applicationContext
        // Everything is always backed up; there's nothing to turn off.
        val snaps = listOf(
            Snap("contacts", "contacts", "vcf", "Contacts", Manifest.permission.READ_CONTACTS) { Exporters.contacts(ctx, it) },
            Snap("calls", "call log", "xml", "Calls", Manifest.permission.READ_CALL_LOG) { Exporters.calls(ctx, it) },
            Snap("texts", "text messages", "xml", "Texts", Manifest.permission.READ_SMS) { Exporters.texts(ctx, it) },
            Snap("apps", "app list", "html", "Apps", null) { Exporters.apps(ctx, it) },
        )
        for (s in snaps) {
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
        // Photos, videos and documents are always backed up.
        if (Scanner.canReadPhotos(ctx)) {
            note("Listing photos…")
            val p = Scanner.media(ctx, video = false)
            items += p; counts.put("photos", p.size)
            if (Scanner.photosLimited(ctx)) skipped.put("some photos (only the ones you allowed)")
        } else skipped.put("photos")

        if (Scanner.canReadVideos(ctx)) {
            note("Listing videos…")
            val v = Scanner.media(ctx, video = true)
            items += v; counts.put("videos", v.size)
        } else skipped.put("videos")

        if (Scanner.hasAllFiles()) {
            note("Listing documents…")
            try {
                val docs = Scanner.documents(ctx)
                items += docs; counts.put("files", docs.size)
            } catch (e: Exception) {
                problem("Couldn't read documents: ${e.message}")
            }
        } else skipped.put("documents")
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
                liveDone += now - offset
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
            liveDone += now - offset
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
        sendLive()
        if (item.size > 8 * CHUNK) note("Uploading ${item.remote.substringAfterLast('/')} — ${pct(offset, item.size)}%${etaSuffix()}")
    }

    /** Seconds left at the current upload rate, or -1 until there's enough to estimate. */
    private fun etaSeconds(): Long {
        val elapsed = System.currentTimeMillis() - uploadStart
        if (liveDone < 512 * 1024 || elapsed < 3000 || toSendTotal <= 0) return -1
        val rate = liveDone.toDouble() / elapsed // bytes per ms
        if (rate <= 0) return -1
        return ((toSendTotal - liveDone) / rate / 1000).toLong().coerceAtLeast(0)
    }

    /**
     * Sends a "running" report so the site can show a progress bar and ETA.
     * Fire-and-forget on its own thread so a slow or offline server never
     * holds up the upload; throttled to one every 30 seconds.
     */
    private fun sendLive(force: Boolean = false) {
        val api = liveApi ?: return
        val now = System.currentTimeMillis()
        if (!force && now - lastLive < 30_000) return
        lastLive = now
        val r = JSONObject().apply {
            put("running", true)
            put("at", now)
            put("done", liveFilesDone)
            put("total", liveFilesTotal)
            put("bytesDone", liveDone)
            put("bytesTotal", toSendTotal)
            val eta = etaSeconds()
            if (eta >= 0) put("etaSec", eta)
            liveCounts?.let { put("counts", JSONObject(it.toString())) }
        }
        Thread { runCatching { api.report(r) } }.start()
    }

    /** " · about 25 min left", once there's enough uploaded to estimate. */
    private fun etaSuffix(): String {
        val elapsed = System.currentTimeMillis() - uploadStart
        if (liveDone < 512 * 1024 || elapsed < 3000 || toSendTotal <= 0) return ""
        val rate = liveDone.toDouble() / elapsed // bytes per ms
        if (rate <= 0) return ""
        val remainingMs = ((toSendTotal - liveDone) / rate).toLong()
        return " · ${humanTime(remainingMs)} left"
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
        // Deliberately generic — no file names or categories on the lock screen.
        val n = NotificationCompat.Builder(applicationContext, CHANNEL)
            .setContentTitle("Rent Roll")
            .setContentText("Backup in progress")
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
        return "Backing up $i of $total$p${etaSuffix()}"
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

        /** "under a minute", "about 25 min", "about 2 hr 10 min". */
        fun humanTime(ms: Long): String {
            val sec = ms / 1000
            if (sec < 60) return "under a minute"
            val min = sec / 60
            if (min < 60) return "about $min min"
            val hr = min / 60; val rem = min % 60
            return if (rem == 0L) "about $hr hr" else "about $hr hr $rem min"
        }

        /** Backs up every 12 hours, within the user's Wi-Fi / charging choices. */
        fun schedule(ctx: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
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

        /** True while a backup is actually running on this phone. */
        fun isRunning(ctx: Context): Boolean = try {
            val wm = WorkManager.getInstance(ctx)
            (wm.getWorkInfosForUniqueWork(ONE_OFF).get() + wm.getWorkInfosForUniqueWork(PERIODIC).get())
                .any { it.state == WorkInfo.State.RUNNING }
        } catch (_: Exception) { false }

        /**
         * Runs a backup right now (the "Back up now" button). Any network, any power.
         * If one is already running it's left alone; anything merely queued (e.g. an
         * old job from v1.4 stuck waiting for Wi-Fi) is replaced, so a tap always starts.
         */
        fun runNow(ctx: Context) {
            if (isRunning(ctx)) return
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val work = OneTimeWorkRequestBuilder<BackupWorker>()
                .setConstraints(constraints)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(ONE_OFF, ExistingWorkPolicy.REPLACE, work)
        }
    }
}

private typealias IOException = java.io.IOException

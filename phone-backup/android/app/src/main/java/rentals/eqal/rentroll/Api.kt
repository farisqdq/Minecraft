package rentals.eqal.rentroll

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit

/** Something the server said no to, with its message for people. */
class ApiError(val status: Int, message: String, val body: JSONObject? = null) : IOException(message)

/** Talks to the backup server on the VPS (phone-backup/server/main.go). */
class Api(private val server: String, private val token: String?) {

    private val json = "application/json".toMediaType()

    private fun req(path: String): Request.Builder {
        val b = Request.Builder().url(server + path).header("User-Agent", "RentRollAndroid/${BuildConfig.VERSION_NAME}")
        if (token != null) b.header("Authorization", "Bearer $token")
        return b
    }

    private fun call(request: Request): JSONObject {
        client.newCall(request).execute().use { res ->
            val text = res.body?.string().orEmpty()
            val obj = runCatching { JSONObject(text) }.getOrNull()
            if (!res.isSuccessful) {
                val msg = obj?.optString("error")?.takeIf { it.isNotBlank() }
                    ?: "The backup server answered ${res.code}."
                throw ApiError(res.code, msg, obj)
            }
            return obj ?: JSONObject()
        }
    }

    data class Paired(val deviceId: String, val name: String, val token: String)

    fun pair(code: String, model: String): Paired {
        val body = JSONObject().put("code", code).put("model", model).toString().toRequestBody(json)
        val o = call(req("/api/pair").post(body).build())
        return Paired(o.getString("deviceId"), o.getString("name"), o.getString("token"))
    }

    fun me(): JSONObject = call(req("/api/device/me").get().build())

    data class CheckResult(val need: Map<String, Long>, val lowOnSpace: Boolean)

    /** Which of these files the server still needs, and from which byte. */
    fun check(files: List<Pair<String, Long>>): CheckResult {
        val arr = JSONArray()
        files.forEach { (p, s) -> arr.put(JSONObject().put("p", p).put("s", s)) }
        val o = call(req("/api/device/check").post(JSONObject().put("files", arr).toString().toRequestBody(json)).build())
        val need = HashMap<String, Long>()
        val list = o.optJSONArray("need") ?: JSONArray()
        for (i in 0 until list.length()) {
            val n = list.getJSONObject(i)
            need[n.getString("p")] = n.optLong("have", 0)
        }
        return CheckResult(need, o.optBoolean("lowOnSpace"))
    }

    /**
     * Sends `length` bytes read from `input` as the part of the file starting
     * at `offset`. Returns how many bytes of the file the server now has.
     */
    fun uploadChunk(path: String, offset: Long, total: Long, mtime: Long, input: InputStream, length: Long): Long {
        val url = (server + "/api/device/upload").toHttpUrl().newBuilder()
            .addQueryParameter("p", path)
            .addQueryParameter("o", offset.toString())
            .addQueryParameter("t", total.toString())
            .addQueryParameter("m", mtime.toString())
            .build()
        val body = object : RequestBody() {
            override fun contentType(): MediaType = "application/octet-stream".toMediaType()
            override fun contentLength(): Long = length
            override fun isOneShot(): Boolean = true
            override fun writeTo(sink: BufferedSink) {
                val buf = ByteArray(64 * 1024)
                var left = length
                while (left > 0) {
                    val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (n < 0) throw IOException("File got shorter while backing it up")
                    sink.write(buf, 0, n)
                    left -= n
                }
            }
        }
        val request = req("").url(url).put(body).build()
        return try {
            call(request).getLong("have")
        } catch (e: ApiError) {
            // 409: the server has a different amount than we thought; resume from there.
            val have = e.body?.optLong("have", -1) ?: -1
            if (e.status == 409 && have >= 0) have else throw e
        }
    }

    fun report(report: JSONObject) {
        call(req("/api/device/report").post(report.toString().toRequestBody(json)).build())
    }

    fun postLocation(body: JSONObject) {
        call(req("/api/device/location").post(body.toString().toRequestBody(json)).build())
    }

    companion object {
        val client: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.MINUTES)
            .writeTimeout(5, TimeUnit.MINUTES)
            .retryOnConnectionFailure(true)
            .build()
    }
}

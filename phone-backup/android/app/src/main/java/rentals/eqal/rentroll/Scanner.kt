package rentals.eqal.rentroll

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import java.io.File
import java.io.InputStream

/** One file to back up: where it goes on the server and how to read it. */
class Item(
    val remote: String,
    val size: Long,
    val mtime: Long,
    val kind: String,
    val open: () -> InputStream?,
)

object Scanner {

    fun canReadPhotos(ctx: Context): Boolean = if (Build.VERSION.SDK_INT >= 33)
        Exporters.has(ctx, Manifest.permission.READ_MEDIA_IMAGES)
    else Exporters.has(ctx, Manifest.permission.READ_EXTERNAL_STORAGE)

    fun canReadVideos(ctx: Context): Boolean = if (Build.VERSION.SDK_INT >= 33)
        Exporters.has(ctx, Manifest.permission.READ_MEDIA_VIDEO)
    else Exporters.has(ctx, Manifest.permission.READ_EXTERNAL_STORAGE)

    /** Android 14+ "Select photos" instead of "Allow all": only the picked ones are visible. */
    fun photosLimited(ctx: Context): Boolean = Build.VERSION.SDK_INT >= 34 &&
        !Exporters.has(ctx, Manifest.permission.READ_MEDIA_IMAGES) &&
        Exporters.has(ctx, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)

    /** Photos or videos from the phone's media library, keeping their folders (DCIM/Camera, Pictures/Screenshots…). */
    fun media(ctx: Context, video: Boolean): List<Item> {
        val q = Build.VERSION.SDK_INT >= 29
        val base: Uri = when {
            video && q -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            video -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            q -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            else -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }
        val cols = mutableListOf(
            MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED,
        )
        if (q) cols += listOf(MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.IS_PENDING)
        else @Suppress("DEPRECATION") cols += MediaStore.MediaColumns.DATA

        // Without this permission Android blanks out where photos were taken.
        val keepLocation = q && Exporters.has(ctx, Manifest.permission.ACCESS_MEDIA_LOCATION)
        val root = Environment.getExternalStorageDirectory().absolutePath.trimEnd('/') + "/"
        val out = ArrayList<Item>()
        val kind = if (video) "videos" else "photos"
        ctx.contentResolver.query(base, cols.toTypedArray(), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val id = c.getLong(0)
                val name = c.getString(1) ?: continue
                val size = c.getLong(2)
                if (size <= 0) continue
                val mtime = c.getLong(3) * 1000
                val folder = if (q) {
                    if (c.getInt(5) == 1) continue // still being written
                    c.getString(4) ?: ""
                } else {
                    val data = c.getString(4) ?: ""
                    File(data.removePrefix(root)).parent?.plus("/") ?: ""
                }
                var uri = ContentUris.withAppendedId(base, id)
                if (keepLocation) uri = MediaStore.setRequireOriginal(uri)
                val remote = "Photos/" + (folder.trim('/').ifEmpty { "Other" }) + "/" + name
                out += Item(remote, size, mtime, kind) { ctx.contentResolver.openInputStream(uri) }
            }
        }
        return out
    }

    /** Display name of a folder picked with the system picker. */
    fun folderName(ctx: Context, tree: Uri): String {
        return try {
            val doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            ctx.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
                ?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "Folder"
        } catch (_: Exception) {
            "Folder (no longer available)"
        }
    }

    /** Every file inside a picked folder, including subfolders. */
    fun folder(ctx: Context, tree: Uri): List<Item> {
        val rootId = DocumentsContract.getTreeDocumentId(tree)
        val rootName = folderName(ctx, tree)
        val out = ArrayList<Item>()
        val stack = ArrayDeque<Pair<String, String>>() // docId, path under root
        stack.add(rootId to "")
        val cols = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        )
        var guard = 0
        while (stack.isNotEmpty() && guard++ < 20000) {
            val (docId, path) = stack.removeLast()
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
            ctx.contentResolver.query(children, cols, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getString(0) ?: continue
                    val name = c.getString(1) ?: continue
                    val sub = if (path.isEmpty()) name else "$path/$name"
                    if (c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) {
                        if (sub.count { it == '/' } < 30) stack.add(id to sub)
                        continue
                    }
                    val size = c.getLong(3)
                    if (size <= 0) continue
                    val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
                    out += Item("Files/$rootName/$sub", size, c.getLong(4), "files") {
                        ctx.contentResolver.openInputStream(uri)
                    }
                }
            }
        }
        return out
    }
}

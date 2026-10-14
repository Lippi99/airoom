package com.airoom.furniturear

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Downloads models on demand and keeps them on disk (CLAUDE.md 4.5: never bundled,
 * cached on device). Files are keyed by URL; the least recently used are evicted
 * once the cache exceeds [maxBytes].
 */
internal class ModelCache(
  context: Context,
  private val maxBytes: Long = 300L * 1024 * 1024,
) {
  private val dir = File(context.cacheDir, "furniture-ar-models").apply { mkdirs() }

  /** Local file for [url], downloading it first if needed. Runs on the IO dispatcher. */
  suspend fun get(url: String): File = withContext(Dispatchers.IO) {
    val file = File(dir, "${sha256(url)}.${extensionOf(url)}")
    if (file.isFile && file.length() > 0) {
      file.setLastModified(System.currentTimeMillis())
      return@withContext file
    }
    download(url, file)
    evictIfNeeded(keep = file)
    file
  }

  private fun download(url: String, target: File) {
    val tmp = File(dir, "${target.name}.part")
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 15_000
      readTimeout = 30_000
      instanceFollowRedirects = true
    }
    try {
      val status = connection.responseCode
      if (status !in 200..299) throw IOException("HTTP $status for $url")
      connection.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
      if (tmp.length() == 0L) throw IOException("Empty model file: $url")
      if (!tmp.renameTo(target)) throw IOException("Could not store model: $url")
    } finally {
      connection.disconnect()
      tmp.delete()
    }
  }

  private fun evictIfNeeded(keep: File) {
    val files = dir.listFiles { f -> f.isFile && !f.name.endsWith(".part") } ?: return
    var total = files.sumOf { it.length() }
    for (file in files.sortedBy { it.lastModified() }) {
      if (total <= maxBytes) break
      if (file == keep) continue
      total -= file.length()
      file.delete()
    }
  }

  private fun extensionOf(url: String): String =
    url.substringBefore('?').substringAfterLast('.', "glb").take(5).lowercase()

  private fun sha256(text: String): String =
    MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}

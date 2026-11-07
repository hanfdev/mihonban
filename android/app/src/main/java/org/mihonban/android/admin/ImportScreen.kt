package org.mihonban.android.admin

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import org.mihonban.android.data.MihonbanRepository
import java.text.Normalizer

internal class ImportViewModel : ViewModel() {
    val action = AdminAction(viewModelScope)
    var files by mutableStateOf<List<PickedAudio>>(emptyList())
    var artist by mutableStateOf("")
    var title by mutableStateOf("")
    var year by mutableStateOf("")
    var folder by mutableStateOf("")
    var mode by mutableStateOf(0)
    var activeFile by mutableStateOf("")
    var completedBytes by mutableLongStateOf(0)
    var totalBytes by mutableLongStateOf(0)
    var importedId by mutableStateOf<String?>(null)
    var boundServer by mutableStateOf("")

    fun bind(server: String) {
        if (boundServer == server) return
        files = emptyList(); importedId = null; artist = ""; title = ""; year = ""; folder = ""
        activeFile = ""; completedBytes = 0; totalBytes = 0; boundServer = server
    }
}

@Composable
fun ImportScreen(repository: MihonbanRepository, onImported: (String) -> Unit) {
    val context = LocalContext.current.applicationContext
    val model: ImportViewModel = viewModel(key = "mihonban-import-${repository.serverScope}")
    val action = model.action
    var confirming by remember { mutableStateOf(false) }
    LaunchedEffect(repository.serverScope) { model.bind(repository.serverScope) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) action.run(null) {
            val parsed = mutableListOf<PickedAudio>()
            uris.forEachIndexed { index, uri ->
                try { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                catch (_: SecurityException) { /* The temporary picker grant still allows the current import. */ }
                parsed += readPickedAudio(context, uri, index + 1)
            }
            val merged = (model.files + parsed).distinctBy { it.uri }.sortedWith(compareBy<PickedAudio> { it.disc }.thenBy { it.track }.thenBy { it.filename })
            require(merged.map { it.filename.lowercase() }.distinct().size == merged.size) { "所选文件包含同名音频，请分成不同专辑导入。" }
            model.files = merged
            fun common(values: List<String>) = values.filter(String::isNotBlank).groupingBy { it }.eachCount().maxByOrNull { it.value }?.key.orEmpty()
            if (model.artist.isBlank()) model.artist = common(merged.map { it.artist })
            if (model.title.isBlank()) model.title = common(merged.map { it.album })
            if (model.year.isBlank()) model.year = common(merged.map { it.year }).take(4)
            model.importedId = null
        }
    }
    val validYear = model.year.isBlank() || model.year.toIntOrNull()?.let { it in 1..9999 } == true
    val targetFolder = if (model.folder.isNotBlank()) model.folder.trim() else
        "Music/Library/${cleanPart(model.artist)}/${if (model.year.isBlank()) "" else "[${model.year}] "}${cleanPart(model.title)}"
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("导入音乐", style = MaterialTheme.typography.headlineMedium)
        Text("把音乐加入自己的曲库，在所有客户端同步浏览与播放。", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(model.mode == 0, { model.mode = 0 }, enabled = !action.busy, label = { Text("手机音频文件") })
            FilterChip(model.mode == 1, { model.mode = 1 }, enabled = !action.busy, label = { Text("服务器文件夹") })
        }
        if (model.mode == 0) AdminSection("选择音频", "通过 Android 文件选择器读取文件，无需授予整个存储的访问权限。") {
            OutlinedButton(onClick = { picker.launch(arrayOf("audio/*", "application/ogg", "application/octet-stream")) }, enabled = !action.busy) {
                Text(if (model.files.isEmpty()) "选择音频文件" else "添加更多文件")
            }
            model.files.forEachIndexed { index, file ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("${index + 1}. ${file.title}", style = MaterialTheme.typography.bodyMedium)
                        Text("${file.format.uppercase()} · %.1f MB · ${file.filename}".format(file.size / 1_000_000.0),
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = { model.files = model.files.filter { it.uri != file.uri } }, enabled = !action.busy) { Text("移除") }
                }
            }
        }
        AdminSection(if (model.mode == 0) "确认专辑信息" else "扫描已存储的音乐",
            if (model.mode == 1) "填写已配置存储中的曲库逻辑路径，例如 Music/Library/Artist/[2024] Album。已有专辑会使用自己的存储。" else null) {
            AdminField("艺人${if (model.mode == 1) "（可选）" else ""}", model.artist, { model.artist = it }, enabled = !action.busy)
            AdminField("专辑名称${if (model.mode == 1) "（可选）" else ""}", model.title, { model.title = it }, enabled = !action.busy)
            AdminField("发行年份（可选）", model.year, { model.year = it }, numeric = true, enabled = !action.busy,
                supporting = if (validYear) null else "请输入 1 至 9999 的年份")
            AdminField(if (model.mode == 0) "自定义存储文件夹（可选）" else "存储文件夹", model.folder,
                { model.folder = it }, enabled = !action.busy)
            if (model.mode == 0 && model.artist.isNotBlank() && model.title.isNotBlank()) {
                Text("目标：$targetFolder", style = MaterialTheme.typography.bodySmall)
            }
            ActionStatus(action)
            if (model.activeFile.isNotEmpty() && action.busy) {
                Text("正在上传：${model.activeFile}", style = MaterialTheme.typography.bodySmall)
                val progress = if (model.totalBytes > 0) (model.completedBytes.toDouble() / model.totalBytes).toFloat().coerceIn(0f, 1f) else 0f
                LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
                Text("${(progress * 100).toInt()}% · 请保持应用运行，上传完成后会登记专辑。", style = MaterialTheme.typography.bodySmall)
            }
            Button(onClick = { confirming = true }, enabled = !action.busy && validYear &&
                if (model.mode == 0) model.files.isNotEmpty() && model.artist.isNotBlank() && model.title.isNotBlank()
                else model.folder.isNotBlank()) { Text(if (model.mode == 0) "上传并导入" else "扫描并导入") }
            model.importedId?.let { id ->
                FilledTonalButton(onClick = { onImported(id) }, enabled = !action.busy) { Text("打开已导入专辑") }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
    if (confirming) AlertDialog(onDismissRequest = { confirming = false },
        title = { Text(if (model.mode == 0) "导入这张专辑？" else "扫描并更新曲库？") },
        text = { Text(if (model.mode == 0)
            "将上传 ${model.files.size} 个文件到：\n$targetFolder\n\n已有同名文件可能被覆盖。上传全部通过校验后才会登记曲库。"
            else "将读取 ${model.folder.trim()}，并更新对应专辑的曲目列表。已移走的曲目会从曲库移除。") },
        confirmButton = { TextButton(onClick = {
            confirming = false
            val expectedServer = repository.serverScope
            val files = model.files.toList()
            val folder = if (model.mode == 0) targetFolder else model.folder.trim()
            val artist = model.artist.trim(); val title = model.title.trim(); val year = model.year.toIntOrNull()
            val fromPhone = model.mode == 0
            action.run("导入完成") {
                require(folder.length <= 400 && folder.split('/').none { it == ".." || it == "." || it.length > 255 }) { "存储路径无效或过长" }
                if (fromPhone) {
                    require(artist.length in 1..500 && title.length in 1..1000 && cleanPart(artist).isNotBlank() && cleanPart(title).isNotBlank()) {
                        "请填写有效的艺人和专辑名称"
                    }
                    require(files.size in 1..20_000 && files.all { it.title.length in 1..1000 && it.disc >= 1 && it.track >= 1 }) {
                        "曲目标题或碟号、曲序无效，请修正文件标签后重试"
                    }
                }
                require(repository.serverScope == expectedServer) { "服务器已切换，请重新导入" }
                model.importedId = null
                try {
                    if (fromPhone) {
                        val uploader = AudioUploader(context, repository)
                        model.totalBytes = files.sumOf { it.size }; model.completedBytes = 0
                        var completed = 0L
                        for (file in files) {
                            require(repository.serverScope == expectedServer) { "服务器已切换，上传已停止" }
                            model.activeFile = file.filename
                            uploader.upload(file, "$folder/${file.filename}") { sent -> model.completedBytes = completed + sent }
                            completed += file.size
                        }
                        require(repository.serverScope == expectedServer) { "服务器已切换，请回到原服务器重新导入" }
                        model.activeFile = "登记专辑"
                        val result = repository.request("POST", "/api/albums", buildJsonObject {
                            put("folder", folder); put("artist", artist); put("title", title)
                            put("year", year?.let(::JsonPrimitive) ?: JsonNull)
                            put("tracks", JsonArray(files.map { file -> buildJsonObject {
                                put("path", "$folder/${file.filename}"); put("title", file.title)
                                put("track", file.track); put("disc", file.disc); put("duration", file.duration)
                                put("format", file.format); put("size", file.size)
                            } }))
                        }).obj()
                        model.importedId = result.text("id").takeIf(String::isNotBlank)
                    } else {
                        val result = repository.request("POST", "/api/scan", buildJsonObject {
                            put("folder", folder)
                            if (artist.isNotBlank()) put("artist", artist)
                            if (title.isNotBlank()) put("title", title)
                            if (year != null) put("year", year)
                        }).obj()
                        model.importedId = result.text("id").takeIf(String::isNotBlank)
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                finally { model.activeFile = "" }
            }
        }) { Text("确认导入") } },
        dismissButton = { TextButton(onClick = { confirming = false }) { Text("取消") } })
}

private fun cleanPart(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFC)
    .replace(Regex("[<>:\"/\\\\|?*\\p{Cntrl}]"), "").trim().trimEnd('.', ' ')

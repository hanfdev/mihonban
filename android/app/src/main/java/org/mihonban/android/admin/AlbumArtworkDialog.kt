package org.mihonban.android.admin

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.imageLoader
import coil.compose.AsyncImage
import kotlinx.serialization.json.*
import org.mihonban.android.data.Album
import org.mihonban.android.data.MihonbanRepository

@Composable
fun AlbumArtworkDialog(repository: MihonbanRepository, album: Album,
    onDismiss: () -> Unit, onSaved: () -> Unit) {
    var images by remember(album.id) { mutableStateOf(album.images) }
    var path by remember { mutableStateOf("") }
    var ref by remember { mutableStateOf("") }
    var candidates by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var selected by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var asCover by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<String?>(null) }
    var dirty by remember { mutableStateOf(false) }
    val action = rememberAdminAction()
    val context = LocalContext.current
    val imageLoader = context.imageLoader
    val finish: () -> Unit = { if (dirty) onSaved() else onDismiss() }
    EditorDialog("封面与内页", finish, action, saveLabel = "完成", onSave = finish) {
        Text(album.title, style = MaterialTheme.typography.titleMedium)
        images.forEachIndexed { index, id ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AsyncImage(repository.imageUrl(id), "内页 ${index + 1}", imageLoader,
                    Modifier.size(76.dp), contentScale = ContentScale.Crop)
                Column(Modifier.weight(1f)) {
                    Text("内页 ${index + 1}", style = MaterialTheme.typography.bodyMedium)
                    Row {
                        if (index > 0) TextButton(onClick = { action.run("顺序已更新") {
                            val reordered = images.toMutableList().apply { add(index - 1, removeAt(index)) }
                            repository.request("PUT", "/api/album/${segment(album.id)}/images/reorder",
                                buildJsonObject { put("ids", JsonArray(reordered.map(::JsonPrimitive))) })
                            images = reordered; dirty = true
                        } }, enabled = !action.busy) { Text("上移") }
                        TextButton(onClick = { deleting = id }, enabled = !action.busy) { Text("移除") }
                    }
                }
            }
        }
        if (images.isEmpty()) Text("这张专辑还没有内页图片。", style = MaterialTheme.typography.bodySmall)
        HorizontalDivider()
        AdminField("添加存储中的图片", path, { path = it }, enabled = !action.busy,
            supporting = "图片路径必须位于此专辑文件夹内。")
        OutlinedButton(onClick = { action.run("已添加内页") {
            repository.request("POST", "/api/album/${segment(album.id)}/images", buildJsonObject { put("path", path.trim()) })
            images = repository.album(album.id).images; path = ""; dirty = true
        } }, enabled = !action.busy && path.isNotBlank()) { Text("添加图片") }
        HorizontalDivider()
        Text("Discogs 图片", style = MaterialTheme.typography.titleMedium)
        AdminField("Discogs release / master 链接", ref, { ref = it; candidates = emptyList(); selected = emptySet() }, enabled = !action.busy)
        OutlinedButton(onClick = { action.run(null) {
            candidates = repository.request("POST", "/api/album/${segment(album.id)}/discogs-image-list",
                buildJsonObject { put("ref", ref.trim()) }).obj().list("images").map { it.obj() }
            selected = emptySet()
        } }, enabled = !action.busy && ref.isNotBlank()) { Text("读取图片列表") }
        candidates.forEach { candidate ->
            val index = candidate.text("idx").toIntOrNull() ?: -1
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Checkbox(index in selected, onCheckedChange = { checked ->
                    selected = if (checked) selected + index else selected - index
                }, enabled = !action.busy && index >= 0)
                val imageUrl = repository.serverUrl + "/api/discogs-image-proxy?url=" + segment(candidate.text("thumb"))
                AsyncImage(imageUrl, "Discogs 图片 ${index + 1}", imageLoader, Modifier.size(64.dp), contentScale = ContentScale.Crop)
                Column {
                    Text(if (candidate.text("type") == "primary") "主要封面" else "内页 ${index + 1}")
                    Text("${candidate.text("w")} × ${candidate.text("h")}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (candidates.isNotEmpty()) {
            ToggleRow("将第一张选中图片设为专辑封面", asCover, !action.busy) { asCover = it }
            Button(onClick = { action.run(null) {
                val result = repository.request("POST", "/api/album/${segment(album.id)}/discogs-import-images",
                    buildJsonObject {
                        put("ref", ref.trim()); put("asCover", asCover)
                        put("images", JsonArray(candidates.filter { it.text("idx").toIntOrNull() in selected }.map {
                            buildJsonObject { put("idx", it.text("idx").toInt()); put("uri", it.text("uri")) }
                        }))
                    }).obj()
                images = repository.album(album.id).images; dirty = true
                selected = emptySet()
                val failures = result.text("failed").toIntOrNull() ?: 0
                action.message = "已导入 ${result.text("imported")} 张，跳过 ${result.text("skipped")} 张" +
                    if (failures > 0 || result.flag("coverFailed")) "；部分图片或封面导入失败，请重试。" else "。"
            } }, enabled = !action.busy && selected.isNotEmpty()) { Text("导入选中的 ${selected.size} 张图片") }
        }
    }
    deleting?.let { id ->
        AlertDialog(onDismissRequest = { if (!action.busy) deleting = null }, title = { Text("移除这张内页？") },
            text = { Column { Text("将移除曲库中的内页记录，保留存储中的原图。"); ActionStatus(action) } },
            confirmButton = { TextButton(onClick = { action.run("已移除内页") {
                repository.request("DELETE", "/api/album/${segment(album.id)}/images/${segment(id)}")
                images = images.filter { it != id }; deleting = null; dirty = true
            } }, enabled = !action.busy) { Text("移除") } },
            dismissButton = { TextButton(onClick = { deleting = null }, enabled = !action.busy) { Text("取消") } })
    }
}

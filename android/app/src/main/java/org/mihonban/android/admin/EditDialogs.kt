package org.mihonban.android.admin

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import org.mihonban.android.data.Album
import org.mihonban.android.data.Artist
import org.mihonban.android.data.ArtistCredit
import org.mihonban.android.data.MihonbanRepository
import org.mihonban.android.data.Track

private fun creditsJson(credits: List<ArtistCredit>) = JsonArray(credits.map { credit ->
    buildJsonObject { put("name", credit.name.trim()); put("sort", credit.sort.trim()) }
})

private fun validCredits(credits: List<ArtistCredit>, allowEmpty: Boolean = false): Boolean {
    if (credits.isEmpty()) return allowEmpty
    return credits.size <= 24 && credits.all { it.name.isNotBlank() && it.name.length <= 500 && it.sort.length <= 500 } &&
        credits.map { it.name.trim().lowercase() }.distinct().size == credits.size &&
        credits.joinToString(", ") { it.name.trim() }.length <= 500
}

@Composable
private fun CreditsEditor(credits: List<ArtistCredit>, onChange: (List<ArtistCredit>) -> Unit,
    enabled: Boolean, allowEmpty: Boolean = false) {
    Text("艺人署名", style = MaterialTheme.typography.titleMedium)
    Text("每位艺人单独一项，依照展示顺序排列。排序名可留空。", style = MaterialTheme.typography.bodySmall)
    credits.forEachIndexed { index, credit ->
        AdminField("艺人 ${index + 1}", credit.name, { name ->
            onChange(credits.toMutableList().apply { set(index, credit.copy(name = name)) })
        }, enabled = enabled)
        AdminField("排序名 ${index + 1}", credit.sort, { sort ->
            onChange(credits.toMutableList().apply { set(index, credit.copy(sort = sort)) })
        }, enabled = enabled)
        Row {
            if (index > 0) TextButton(onClick = {
                onChange(credits.toMutableList().apply { add(index - 1, removeAt(index)) })
            }, enabled = enabled) { Text("上移") }
            if (credits.size > 1 || allowEmpty) TextButton(onClick = {
                onChange(credits.filterIndexed { i, _ -> i != index })
            }, enabled = enabled) { Text("移除署名") }
        }
    }
    if (credits.size < 24) OutlinedButton(onClick = { onChange(credits + ArtistCredit("")) }, enabled = enabled) { Text("添加艺人") }
}

@Composable
fun AlbumEditDialog(repository: MihonbanRepository, album: Album, onDismiss: () -> Unit,
    onSaved: () -> Unit, onDeleted: () -> Unit = onSaved) {
    var title by remember(album.id) { mutableStateOf(album.title) }
    var year by remember(album.id) { mutableStateOf(album.year?.toString().orEmpty()) }
    var credits by remember(album.id) { mutableStateOf(album.credits) }
    var genres by remember(album.id) { mutableStateOf(album.genres.joinToString("; ")) }
    var secondary by remember(album.id) { mutableStateOf(album.secondaryGenres.joinToString("; ")) }
    var descriptors by remember(album.id) { mutableStateOf(album.rym?.descriptors.orEmpty().joinToString("; ")) }
    var note by remember(album.id) { mutableStateOf(album.note) }
    var coverPath by remember(album.id) { mutableStateOf("") }
    var confirmAction by remember { mutableStateOf<String?>(null) }
    var deleteFiles by remember { mutableStateOf(false) }
    var discogsUrl by remember { mutableStateOf("") }
    var discogs by remember { mutableStateOf<JsonObject?>(null) }
    val action = rememberAdminAction()
    val validYear = year.isBlank() || year.toIntOrNull()?.let { it in 1..9999 } == true
    EditorDialog("编辑专辑", onDismiss, action,
        saveEnabled = title.isNotBlank() && title.length <= 1000 && validYear && validCredits(credits),
        onSave = { action.run(null) {
            repository.request("PATCH", "/api/album/${segment(album.id)}", buildJsonObject {
                put("title", title.trim()); put("year", year.toIntOrNull()?.let(::JsonPrimitive) ?: JsonNull)
                put("artists", creditsJson(credits)); put("genres", tagsJson(genres))
                put("secondaryGenres", tagsJson(secondary)); put("descriptors", tagsJson(descriptors))
                put("note", note)
                if (coverPath.isNotBlank()) put("coverPath", coverPath.trim())
            }); onSaved()
        } }) {
        AdminField("专辑名称", title, { title = it }, enabled = !action.busy)
        AdminField("发行年份", year, { year = it }, numeric = true, enabled = !action.busy,
            supporting = if (validYear) "留空表示未知" else "请输入 1 至 9999 的年份")
        CreditsEditor(credits, { credits = it }, !action.busy)
        HorizontalDivider()
        AdminField("主要流派（分号分隔）", genres, { genres = it }, enabled = !action.busy)
        AdminField("次要流派（分号分隔）", secondary, { secondary = it }, enabled = !action.busy)
        AdminField("描述标签（分号分隔）", descriptors, { descriptors = it }, enabled = !action.busy)
        AdminField("笔记", note, { note = it }, multiline = true, enabled = !action.busy)
        AdminField("替换封面路径", coverPath, { coverPath = it }, enabled = !action.busy,
            supporting = "填写存储中此专辑目录内的图片路径；留空保留当前封面")
        HorizontalDivider()
        Text("从 Discogs 补充流派", style = MaterialTheme.typography.titleMedium)
        AdminField("Discogs release / master 链接", discogsUrl, { discogsUrl = it; discogs = null }, enabled = !action.busy)
        OutlinedButton(onClick = { action.run(null) {
            discogs = repository.request("POST", "/api/discogs-lookup",
                buildJsonObject { put("url", discogsUrl.trim()) }).obj()
        } }, enabled = discogsUrl.isNotBlank() && !action.busy) { Text("查询元数据") }
        discogs?.let { result ->
            Text(result.text("title"), style = MaterialTheme.typography.titleSmall)
            Text((result.list("genres") + result.list("styles")).joinToString(" · ") {
                (it as? JsonPrimitive)?.contentOrNull.orEmpty()
            })
            TextButton(onClick = {
                val allPrimary = splitTags(genres) + result.list("styles").mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                genres = allPrimary.distinctBy(String::lowercase).joinToString("; ")
                secondary = (splitTags(secondary) + result.list("genres").mapNotNull { (it as? JsonPrimitive)?.contentOrNull })
                    .filter { value -> allPrimary.none { it.equals(value, true) } }.distinctBy(String::lowercase).joinToString("; ")
                if (year.isBlank()) year = result.text("year").takeIf { it.toIntOrNull()?.let { y -> y in 1..9999 } == true }.orEmpty()
                discogs = null
            }) { Text("合并到表单") }
        }
        HorizontalDivider()
        Text("专辑管理", style = MaterialTheme.typography.titleMedium)
        Text(album.folder, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            TextButton(onClick = { confirmAction = "visibility" }, enabled = !action.busy) { Text(if (album.hidden) "恢复公开" else "隐藏专辑") }
            TextButton(onClick = { confirmAction = "rescan" }, enabled = !action.busy && album.folder.isNotBlank()) { Text("重新扫描文件夹") }
            TextButton(onClick = { confirmAction = "delete" }, enabled = !action.busy,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("删除专辑") }
        }
    }
    confirmAction?.let { operation ->
        AlertDialog(onDismissRequest = { if (!action.busy) confirmAction = null },
            title = { Text(when (operation) {
                "delete" -> "删除“${album.title}”？"
                "rescan" -> "重新扫描专辑文件夹？"
                else -> if (album.hidden) "恢复公开此专辑？" else "隐藏此专辑？"
            }) }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(when (operation) {
                    "delete" -> "将删除曲库中的专辑、曲目和收藏记录。此操作无法撤销。"
                    "rescan" -> "根据存储中的音频文件更新曲目列表，已移走的曲目会从曲库移除。尚未保存的表单修改不会提交。"
                    else -> if (album.hidden) "所有拥有曲库访问权限的听众都将可以浏览和播放此专辑。" else "此专辑将仅对管理员可见。"
                })
                if (operation == "delete") ToggleRow("同时删除存储中的原始文件", deleteFiles, !action.busy) { deleteFiles = it }
                ActionStatus(action)
            } }, confirmButton = { TextButton(onClick = { action.run(null) {
                when (operation) {
                    "delete" -> {
                        repository.request("DELETE", "/api/album/${segment(album.id)}${if (deleteFiles) "?files=1" else ""}")
                        confirmAction = null; onDeleted()
                    }
                    "rescan" -> {
                        repository.request("POST", "/api/scan", buildJsonObject { put("folder", album.folder) })
                        confirmAction = null; onSaved()
                    }
                    else -> {
                        repository.request("POST", "/api/album/${segment(album.id)}/hide", buildJsonObject { put("hidden", !album.hidden) })
                        confirmAction = null; onSaved()
                    }
                }
            } }, enabled = !action.busy) { Text("确认") } },
            dismissButton = { TextButton(onClick = { confirmAction = null }, enabled = !action.busy) { Text("取消") } })
    }
}

@Composable
fun TrackEditDialog(repository: MihonbanRepository, track: Track, onDismiss: () -> Unit, onSaved: () -> Unit) {
    var title by remember(track.id) { mutableStateOf(track.title) }
    var inherited by remember(track.id) { mutableStateOf(!track.hasCustomArtists) }
    var credits by remember(track.id) { mutableStateOf(track.credits) }
    var deleting by remember { mutableStateOf(false) }
    val action = rememberAdminAction()
    EditorDialog("编辑曲目", onDismiss, action,
        saveEnabled = title.isNotBlank() && title.length <= 1000 && (inherited || validCredits(credits)),
        onSave = { action.run(null) {
            repository.request("PATCH", "/api/album/${segment(track.albumId)}/tracks/${segment(track.id)}",
                buildJsonObject { put("title", title.trim()); put("artists", if (inherited) JsonArray(emptyList()) else creditsJson(credits)) })
            onSaved()
        } }) {
        Text(track.albumTitle, style = MaterialTheme.typography.bodySmall)
        AdminField("曲目名称", title, { title = it }, enabled = !action.busy)
        ToggleRow("使用专辑艺人署名", inherited, !action.busy) { inherited = it }
        if (!inherited) CreditsEditor(credits, { credits = it }, !action.busy)
        HorizontalDivider()
        Text("${track.format.uppercase()} · 碟 ${track.disc} · 曲目 ${track.track}", style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = { deleting = true }, enabled = !action.busy,
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("从曲库移除此曲目") }
    }
    if (deleting) AlertDialog(onDismissRequest = { if (!action.busy) deleting = false },
        title = { Text("移除“${track.title}”？") },
        text = { Column { Text("将删除曲目及其收藏记录，保留存储中的原始文件。"); ActionStatus(action) } },
        confirmButton = { TextButton(onClick = { action.run(null) {
            repository.request("DELETE", "/api/album/${segment(track.albumId)}/tracks/${segment(track.id)}")
            onSaved()
        } }, enabled = !action.busy) { Text("移除") } },
        dismissButton = { TextButton(onClick = { deleting = false }, enabled = !action.busy) { Text("取消") } })
}

@Composable
fun ArtistEditDialog(repository: MihonbanRepository, artist: Artist, onDismiss: () -> Unit, onSaved: () -> Unit) {
    var sort by remember(artist.name) { mutableStateOf(artist.sort) }
    var note by remember(artist.name) { mutableStateOf(artist.note) }
    var bio by remember(artist.name) { mutableStateOf("") }
    var loaded by remember(artist.name) { mutableStateOf(false) }
    val action = rememberAdminAction()
    LaunchedEffect(artist.name) { action.run(null) {
        bio = repository.request("GET", "/api/artist-bio/${segment(artist.name)}").obj().text("bio")
        loaded = true
    } }
    EditorDialog("编辑艺人", onDismiss, action, saveEnabled = loaded, onSave = { action.run(null) {
        repository.request("PUT", "/api/artists", buildJsonObject {
            put("name", artist.name); put("artistSort", sort.trim()); put("note", note); put("bio", bio)
        }); onSaved()
    } }) {
        Text(artist.name, style = MaterialTheme.typography.titleLarge)
        AdminField("排序名", sort, { sort = it }, enabled = loaded && !action.busy)
        AdminField("短备注", note, { note = it }, multiline = true, enabled = loaded && !action.busy)
        AdminField("艺人简介", bio, { bio = it }, multiline = true, enabled = loaded && !action.busy,
            supporting = "支持 Markdown 文本，与 Web 端同步。")
    }
}

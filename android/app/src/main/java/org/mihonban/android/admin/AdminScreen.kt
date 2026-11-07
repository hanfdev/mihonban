package org.mihonban.android.admin

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import org.mihonban.android.data.MihonbanRepository

@Composable
fun AdminScreen(repository: MihonbanRepository, onLibraryChanged: () -> Unit) {
    var revision by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("曲库管理", style = MaterialTheme.typography.headlineMedium)
            TextButton(onClick = { revision++; onLibraryChanged() }) { Text("刷新") }
        }
        Text("管理访问权限、音乐存储与元数据来源。", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        OverviewPanel(repository, revision)
        SettingsPanel(repository, revision)
        StoragesPanel(repository, revision)
        R2Panel(repository, revision)
        SourcesPanel(repository, revision)
        PasswordPanel(repository)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun OverviewPanel(repository: MihonbanRepository, revision: Int) {
    var info by remember { mutableStateOf(JsonObject(emptyMap())) }
    val action = rememberAdminAction()
    LaunchedEffect(repository, revision) {
        action.run(null) { info = repository.request("GET", "/api/admin/overview").obj() }
    }
    AdminSection("曲库概览") {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
            listOf("专辑" to info.text("albums"), "曲目" to info.text("tracks"),
                "待处理" to info.text("newPosts")).forEach { (label, value) ->
                Column {
                    Text(value.ifBlank { "—" }, style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.primary)
                    Text(label, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        val bytes = info.text("bytes").toDoubleOrNull() ?: 0.0
        Text("音频体积：%.2f GB".format(bytes / 1_000_000_000.0))
        info.text("sourceLastError").takeIf(String::isNotBlank)?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }
        ActionStatus(action)
    }
}

@Composable
private fun SettingsPanel(repository: MihonbanRepository, revision: Int) {
    var loaded by remember { mutableStateOf(false) }
    var guest by remember { mutableStateOf(false) }
    var source by remember { mutableStateOf(false) }
    var proxy by remember { mutableStateOf(false) }
    var sourceUrl by remember { mutableStateOf("") }
    var proxyUrl by remember { mutableStateOf("") }
    var discogsToken by remember { mutableStateOf("") }
    var tokenConfigured by remember { mutableStateOf(false) }
    var archivePasswords by remember { mutableStateOf("") }
    val action = rememberAdminAction()
    LaunchedEffect(repository, revision) {
        action.run(null) {
            val settings = repository.request("GET", "/api/admin/settings").obj()
            guest = settings.flag("guestOpen")
            source = settings.flag("moduleSource")
            proxy = settings.flag("streamProxy")
            sourceUrl = settings.text("sourceUrl")
            proxyUrl = settings.text("streamProxyUrl")
            tokenConfigured = settings.text("discogsToken").isNotBlank()
            archivePasswords = settings.list("archivePasswords").joinToString("\n") {
                (it as? JsonPrimitive)?.contentOrNull.orEmpty()
            }
            loaded = true
        }
    }
    AdminSection("访问与服务") {
        ToggleRow("允许免口令只读访问", guest, loaded && !action.busy) { guest = it }
        ToggleRow("启用资源站模块", source, loaded && !action.busy) { source = it }
        ToggleRow("通过服务器代理音频", proxy, loaded && !action.busy) { proxy = it }
        AdminField("音频代理地址（留空使用本站）", proxyUrl, { proxyUrl = it }, enabled = loaded)
        AdminField("资源站地址", sourceUrl, { sourceUrl = it }, enabled = loaded)
        AdminField("Discogs Token", discogsToken, { discogsToken = it }, secret = true,
            enabled = loaded, supporting = if (tokenConfigured) "已配置；留空保留现有 Token" else "从 Discogs 账户设置获取个人 Token")
        AdminField("压缩包口令（每行一个）", archivePasswords, { archivePasswords = it },
            multiline = true, enabled = loaded)
        ActionStatus(action)
        Button(onClick = {
            action.run {
                repository.request("PUT", "/api/admin/settings", buildJsonObject {
                    put("guestOpen", guest); put("moduleSource", source); put("streamProxy", proxy)
                    put("sourceUrl", sourceUrl.trim()); put("streamProxyUrl", proxyUrl.trim())
                    put("archivePasswords", JsonArray(archivePasswords.lines().map(String::trim)
                        .filter(String::isNotBlank).map(::JsonPrimitive)))
                    if (discogsToken.isNotBlank()) put("discogsToken", discogsToken.trim())
                })
                if (discogsToken.isNotBlank()) tokenConfigured = true
                discogsToken = ""
            }
        }, enabled = loaded && !action.busy) { Text("保存设置") }
    }
}

@Composable
private fun StoragesPanel(repository: MihonbanRepository, revision: Int) {
    var storages by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var localRevision by remember { mutableIntStateOf(0) }
    var edit by remember { mutableStateOf<JsonObject?>(null) }
    var adding by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<JsonObject?>(null) }
    val action = rememberAdminAction()
    LaunchedEffect(repository, revision, localRevision) {
        action.run(null) {
            storages = repository.request("GET", "/api/admin/storages").obj()
                .list("storages").map { it.obj() }
        }
    }
    AdminSection("音乐存储", "新上传的文件写入主存储；已有专辑继续使用原来的存储位置。") {
        for (storage in storages) {
            Text(storage.text("name"), style = MaterialTheme.typography.titleMedium)
            Text("${storage.text("kind")} · ${storage.text("albums")} 张专辑" +
                if (storage.flag("isWrite")) " · 新上传主位置" else "",
                style = MaterialTheme.typography.bodySmall)
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                TextButton(onClick = { action.run("连接正常") {
                    requireSuccess(repository.request("POST", "/api/admin/storages/test",
                        buildJsonObject { put("id", storage.text("id")) }))
                } }, enabled = !action.busy) { Text("测试连接") }
                TextButton(onClick = { edit = storage }, enabled = !action.busy) { Text("编辑") }
                if (!storage.flag("isWrite")) TextButton(onClick = {
                    action.run("已设为新上传主位置") {
                        repository.request("PUT", "/api/admin/storages/write-target",
                            buildJsonObject { put("id", storage.text("id")) })
                        localRevision++
                    }
                }, enabled = !action.busy) { Text("设为主存储") }
                TextButton(onClick = { deleting = storage }, enabled = !action.busy) { Text("移除") }
            }
            HorizontalDivider()
        }
        if (storages.isEmpty() && !action.busy) Text("尚未添加存储。")
        ActionStatus(action)
        OutlinedButton(onClick = { adding = true }, enabled = !action.busy) { Text("添加存储") }
    }
    if (adding || edit != null) StorageEditor(repository, edit,
        onDismiss = { adding = false; edit = null },
        onSaved = { adding = false; edit = null; localRevision++ })
    deleting?.let { storage ->
        AlertDialog(onDismissRequest = { if (!action.busy) deleting = null },
            title = { Text("移除存储配置？") },
            text = { Column {
                Text("将移除“${storage.text("name")}”的连接配置。服务器会拒绝移除仍被专辑或头像使用的存储；远端文件不会被删除。")
                ActionStatus(action)
            } },
            confirmButton = { TextButton(onClick = { action.run("已移除存储") {
                repository.request("DELETE", "/api/admin/storages/${segment(storage.text("id"))}")
                deleting = null; localRevision++
            } }, enabled = !action.busy) { Text("移除") } },
            dismissButton = { TextButton(onClick = { deleting = null }, enabled = !action.busy) { Text("取消") } })
    }
}

@Composable
private fun StorageEditor(repository: MihonbanRepository, storage: JsonObject?,
    onDismiss: () -> Unit, onSaved: () -> Unit) {
    var name by remember { mutableStateOf(storage?.text("name").orEmpty()) }
    var kind by remember { mutableStateOf(storage?.text("kind") ?: "webdav") }
    val values = remember { mutableStateMapOf<String, String>().apply {
        storage?.get("config")?.obj()?.forEach { (key, value) ->
            put(key, (value as? JsonPrimitive)?.contentOrNull.orEmpty())
        }
    } }
    val fields = when (kind) {
        "onedrive" -> listOf("clientId" to "Client ID", "clientSecret" to "Client Secret",
            "refreshToken" to "Refresh Token", "driveId" to "Drive ID")
        "gdrive" -> listOf("clientId" to "Client ID", "clientSecret" to "Client Secret",
            "refreshToken" to "Refresh Token", "rootId" to "根文件夹 ID")
        "local" -> listOf("root" to "服务器本地绝对路径", "odRoot" to "曲库逻辑根路径")
        else -> listOf("baseUrl" to "WebDAV 地址", "username" to "用户名", "password" to "密码")
    }
    val action = rememberAdminAction()
    fun payload() = buildJsonObject {
        put("name", name.trim()); if (storage == null) put("kind", kind)
        put("config", buildJsonObject {
            fields.forEach { (key, _) ->
                val value = values[key].orEmpty().trim()
                if (!value.contains("••") && (storage == null || value.isNotEmpty())) put(key, value)
            }
        })
    }
    EditorDialog(if (storage == null) "添加存储" else "编辑存储", onDismiss, action,
        saveEnabled = name.isNotBlank(), onSave = { action.run(null) {
            repository.request(if (storage == null) "POST" else "PUT",
                if (storage == null) "/api/admin/storages" else "/api/admin/storages/${segment(storage.text("id"))}", payload())
            onSaved()
        } }) {
        AdminField("显示名称", name, { name = it }, enabled = !action.busy)
        if (storage == null) Row(Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("webdav" to "WebDAV", "onedrive" to "OneDrive", "gdrive" to "Google Drive", "local" to "本地").forEach { (id, label) ->
                FilterChip(kind == id, { kind = id }, label = { Text(label) }, enabled = !action.busy)
            }
        }
        if (kind == "local") Text("本地文件夹仅适用于 Node 服务器，路径位于服务器电脑。", style = MaterialTheme.typography.bodySmall)
        fields.forEach { (key, label) ->
            AdminField(label, values[key].orEmpty(), { values[key] = it },
                secret = key in setOf("clientSecret", "refreshToken", "password"), enabled = !action.busy)
        }
        if (storage != null) Text("留空或保留掩码可以保留现有凭据。", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun R2Panel(repository: MihonbanRepository, revision: Int) {
    var loaded by remember { mutableStateOf(false) }
    var enabled by remember { mutableStateOf(false) }
    var endpoint by remember { mutableStateOf("") }
    var bucket by remember { mutableStateOf("") }
    var publicUrl by remember { mutableStateOf("") }
    var accessKey by remember { mutableStateOf("") }
    var secretKey by remember { mutableStateOf("") }
    var mirrored by remember { mutableStateOf("0") }
    val action = rememberAdminAction()
    LaunchedEffect(repository, revision) { action.run(null) {
        val info = repository.request("GET", "/api/admin/r2").obj()
        enabled = info.flag("enabled"); endpoint = info.text("endpoint"); bucket = info.text("bucket")
        publicUrl = info.text("publicUrl"); mirrored = info.text("mirrored"); loaded = true
    } }
    AdminSection("R2 图片镜像", "已缓存 $mirrored 个图片版本。凭据留空保留现有值。") {
        ToggleRow("启用 R2 镜像", enabled, loaded && !action.busy) { enabled = it }
        AdminField("S3 Endpoint", endpoint, { endpoint = it }, enabled = loaded)
        AdminField("Bucket", bucket, { bucket = it }, enabled = loaded)
        AdminField("公开访问地址", publicUrl, { publicUrl = it }, enabled = loaded)
        AdminField("Access Key", accessKey, { accessKey = it }, secret = true, enabled = loaded)
        AdminField("Secret Key", secretKey, { secretKey = it }, secret = true, enabled = loaded)
        ActionStatus(action)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { action.run {
                repository.request("PUT", "/api/admin/r2", buildJsonObject {
                    put("enabled", enabled); put("endpoint", endpoint.trim()); put("bucket", bucket.trim())
                    put("publicUrl", publicUrl.trim()); put("accessKey", accessKey.trim()); put("secretKey", secretKey.trim())
                }); accessKey = ""; secretKey = ""
            } }, enabled = loaded && !action.busy) { Text("保存镜像配置") }
            OutlinedButton(onClick = { action.run("连接正常") {
                requireSuccess(repository.request("POST", "/api/admin/r2/test"))
            } }, enabled = loaded && !action.busy) { Text("测试已存配置") }
        }
    }
}

@Composable
private fun SourcesPanel(repository: MihonbanRepository, revision: Int) {
    val action = rememberAdminAction()
    var posts by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var deep by remember { mutableStateOf(false) }
    var localRevision by remember { mutableIntStateOf(0) }
    LaunchedEffect(repository, revision, localRevision) {
        if (loaded) action.run(null) {
            posts = repository.request("GET", "/api/admin/source/posts?status=new&limit=100").obj()
                .list("posts").map { it.obj() }
        }
    }
    AdminSection("资源站收件箱", "扫描前请先启用资源站模块并填写来源地址。显示最近 100 条待处理项目。") {
        ToggleRow("深度扫描", deep, !action.busy) { deep = it }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { loaded = true; localRevision++ }, enabled = !action.busy) { Text("读取收件箱") }
            Button(onClick = { action.run("扫描完成") {
                requireSuccess(repository.request("POST", "/api/admin/source/scan", buildJsonObject { put("deep", deep) }))
                loaded = true; localRevision++
            } }, enabled = !action.busy) { Text("扫描来源") }
        }
        ActionStatus(action)
        posts.forEach { post ->
            Text(post.text("title"), style = MaterialTheme.typography.titleSmall)
            Row {
                listOf("done" to "标记完成", "ignored" to "忽略").forEach { (status, label) ->
                    TextButton(onClick = { action.run {
                        repository.request("POST", "/api/admin/source/posts/${segment(post.text("id"))}",
                            buildJsonObject { put("status", status) })
                        posts = posts.filter { it.text("id") != post.text("id") }
                    } }, enabled = !action.busy) { Text(label) }
                }
            }
            HorizontalDivider()
        }
        if (loaded && posts.isEmpty() && !action.busy) Text("没有待处理项目。")
    }
}

@Composable
private fun PasswordPanel(repository: MihonbanRepository) {
    var target by remember { mutableStateOf("user") }
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf(false) }
    val action = rememberAdminAction()
    AdminSection("更改口令", "保存后，服务器会使所有已有登录会话失效，需要使用新口令重新登录。") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(target == "user", { target = "user" }, label = { Text("听众口令") })
            FilterChip(target == "admin", { target = "admin" }, label = { Text("管理员口令") })
        }
        AdminField("当前管理员口令", current, { current = it }, secret = true, enabled = !action.busy)
        AdminField("新口令（至少 4 位）", next, { next = it }, secret = true, enabled = !action.busy)
        AdminField("确认新口令", confirm, { confirm = it }, secret = true, enabled = !action.busy)
        ActionStatus(action)
        Button(onClick = { confirming = true }, enabled = !action.busy && current.isNotBlank() && next.length >= 4 && next == confirm) { Text("更改口令") }
    }
    if (confirming) AlertDialog(onDismissRequest = { if (!action.busy) confirming = false },
        title = { Text("更改${if (target == "admin") "管理员" else "听众"}口令？") },
        text = { Column { Text("此操作会退出所有设备上的现有登录。请保存好新口令。"); ActionStatus(action) } },
        confirmButton = { TextButton(onClick = { action.run("口令已更改，请重新登录") {
            repository.request("POST", "/api/admin/password", buildJsonObject {
                put("target", target); put("current", current); put("next", next)
            }); current = ""; next = ""; confirm = ""; confirming = false
        } }, enabled = !action.busy) { Text("确认更改") } },
        dismissButton = { TextButton(onClick = { confirming = false }, enabled = !action.busy) { Text("取消") } })
}

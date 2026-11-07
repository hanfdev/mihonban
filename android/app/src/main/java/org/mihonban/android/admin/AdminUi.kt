package org.mihonban.android.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import org.mihonban.android.data.MihonbanRepository

internal fun JsonElement.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
internal fun JsonObject.text(key: String): String = (get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
internal fun JsonObject.flag(key: String): Boolean = (get(key) as? JsonPrimitive)?.booleanOrNull == true
internal fun JsonObject.list(key: String): List<JsonElement> = (get(key) as? JsonArray).orEmpty()
internal fun segment(value: String): String = MihonbanRepository.encodeSegment(value)
internal fun splitTags(value: String): List<String> = value.split(';', '；', '\n').map(String::trim)
    .filter(String::isNotBlank).distinctBy(String::lowercase)
internal fun tagsJson(value: String): JsonArray = JsonArray(splitTags(value).map(::JsonPrimitive))

@Stable
internal class AdminAction(private val scope: CoroutineScope) {
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf<String?>(null)
    var failed by mutableStateOf(false)
        private set

    fun run(success: String? = "已保存", block: suspend () -> Unit) {
        if (busy) return
        busy = true
        message = null
        scope.launch {
            try {
                block()
                failed = false
                if (success != null) message = success
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                failed = true
                message = error.message ?: "操作失败，请重试"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
internal fun rememberAdminAction(): AdminAction {
    val scope = rememberCoroutineScope()
    return remember(scope) { AdminAction(scope) }
}

@Composable
internal fun ActionStatus(action: AdminAction) {
    if (action.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    action.message?.let { message ->
        Surface(color = if (action.failed) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.secondaryContainer,
            shape = MaterialTheme.shapes.small) {
            Text(message, Modifier.fillMaxWidth().padding(12.dp),
                color = if (action.failed) MaterialTheme.colorScheme.onErrorContainer
                else MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
internal fun AdminSection(title: String, subtitle: String? = null, content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            content()
        }
    }
}

@Composable
internal fun AdminField(label: String, value: String, onValueChange: (String) -> Unit,
    secret: Boolean = false, multiline: Boolean = false, numeric: Boolean = false,
    enabled: Boolean = true, supporting: String? = null) {
    OutlinedTextField(value, onValueChange, Modifier.fillMaxWidth(), label = { Text(label) },
        singleLine = !multiline, minLines = if (multiline) 3 else 1, maxLines = if (multiline) 8 else 1,
        enabled = enabled,
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = when {
            secret -> KeyboardType.Password
            numeric -> KeyboardType.Number
            else -> KeyboardType.Text
        }), supportingText = supporting?.let { { Text(it) } })
}

@Composable
internal fun ToggleRow(title: String, checked: Boolean, enabled: Boolean = true, onChecked: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().toggleable(value = checked, enabled = enabled, role = Role.Switch,
        onValueChange = onChecked), horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked, onCheckedChange = null, enabled = enabled)
    }
}

@Composable
internal fun EditorDialog(title: String, onDismiss: () -> Unit, action: AdminAction,
    saveLabel: String = "保存", saveEnabled: Boolean = true, onSave: () -> Unit,
    content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = { if (!action.busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().padding(12.dp).widthIn(max = 600.dp)
            .heightIn(max = 760.dp), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(title, style = MaterialTheme.typography.headlineSmall)
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
                ActionStatus(action)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onDismiss, enabled = !action.busy) { Text("取消") }
                    Spacer(Modifier.width(8.dp))
                    Button(onSave, enabled = saveEnabled && !action.busy) { Text(saveLabel) }
                }
            }
        }
    }
}

internal fun requireSuccess(response: JsonElement): JsonObject {
    val result = response.obj()
    if ((result["ok"] as? JsonPrimitive)?.booleanOrNull == false) {
        error(result.text("error").ifBlank { "服务器未能完成操作" })
    }
    return result
}

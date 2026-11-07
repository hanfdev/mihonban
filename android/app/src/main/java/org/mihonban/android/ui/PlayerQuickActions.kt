package org.mihonban.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.QueueMusic
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.mihonban.android.playback.DownloadItem
import org.mihonban.android.playback.DownloadStatus

@Composable
internal fun PlayerQuickActions(download: DownloadItem?, onDownload: () -> Unit, onShare: () -> Unit, onQueue: () -> Unit) {
    val active = download?.status in listOf(DownloadStatus.QUEUED, DownloadStatus.DOWNLOADING)
    val complete = download?.status == DownloadStatus.COMPLETE
    val retry = download?.status in listOf(DownloadStatus.PAUSED, DownloadStatus.FAILED)
    val downloadLabel = when {
        complete -> words("已下载", "Downloaded")
        active -> words("暂停下载", "Pause download")
        retry -> words("重试下载", "Retry download")
        else -> words("下载歌曲", "Download track")
    }
    val downloadStatus = when (download?.status) {
        DownloadStatus.QUEUED -> words("等待下载", "Queued")
        DownloadStatus.DOWNLOADING -> if (download.total > 0) "${(download.progress * 100).toInt()}%" else words("下载中", "Downloading")
        DownloadStatus.COMPLETE -> words("可离线播放", "Available offline")
        DownloadStatus.PAUSED -> words("已暂停", "Paused")
        DownloadStatus.FAILED -> download.error ?: words("下载失败", "Download failed")
        null -> words("未下载", "Not downloaded")
    }
    Row(Modifier.fillMaxWidth().testTag("player-quick-actions"), horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically) {
        QuickAction(if (complete) Icons.Outlined.DownloadDone else if (active) Icons.Outlined.Pause
            else if (retry) Icons.Outlined.Refresh else Icons.Outlined.Download,
            if (active) downloadStatus else if (complete) downloadLabel else words("下载", "Download"),
            downloadLabel, Modifier.weight(1f).testTag("player-download").semantics { stateDescription = downloadStatus },
            enabled = !complete, onClick = onDownload)
        QuickAction(Icons.Outlined.Share, words("分享", "Share"), words("分享歌曲", "Share track"),
            Modifier.weight(1f).testTag("player-share"), onClick = onShare)
        QuickAction(Icons.AutoMirrored.Outlined.QueueMusic, words("队列", "Queue"), words("播放队列", "Queue"),
            Modifier.weight(1f).testTag("player-queue"), onClick = onQueue)
    }
}

@Composable
private fun QuickAction(icon: ImageVector, text: String, label: String, modifier: Modifier,
    enabled: Boolean = true, onClick: () -> Unit) {
    TextButton(onClick, modifier.heightIn(min = 48.dp).semantics { contentDescription = label }, enabled = enabled,
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            disabledContentColor = MaterialTheme.colorScheme.secondary)) {
        Icon(icon, null, Modifier.size(20.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

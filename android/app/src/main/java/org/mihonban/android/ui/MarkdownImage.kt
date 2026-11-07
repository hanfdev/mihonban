package org.mihonban.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter

@Composable
internal fun MarkdownImage(url: String?, alt: String) {
    var attempt by remember(url) { mutableIntStateOf(0) }
    val description = alt.ifBlank { words("简介图片", "Description image") }
    // Recreate only the failed image request; the reader and its scroll state stay mounted.
    key(url, attempt) {
        var state by remember { mutableStateOf<AsyncImagePainter.State>(AsyncImagePainter.State.Empty) }
        val failed = url == null || state is AsyncImagePainter.State.Error
        val frame = when {
            failed -> Modifier.heightIn(min = 160.dp)
            state is AsyncImagePainter.State.Success -> {
                val drawable = (state as AsyncImagePainter.State.Success).result.drawable
                val ratio = if (drawable.intrinsicWidth > 0 && drawable.intrinsicHeight > 0)
                    drawable.intrinsicWidth.toFloat() / drawable.intrinsicHeight else 4f / 3f
                Modifier.heightIn(min = 64.dp, max = 360.dp).aspectRatio(ratio)
            }
            else -> Modifier.heightIn(max = 240.dp).aspectRatio(4f / 3f)
        }
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
            Box(Modifier.fillMaxWidth().then(frame), contentAlignment = Alignment.Center) {
                if (url != null) AsyncImage(
                    model = scopedImageRequest(url),
                    contentDescription = if (state is AsyncImagePainter.State.Success) description else null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Fit,
                    onState = { state = it },
                )
                when {
                    failed -> Column(
                        Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(Icons.Outlined.BrokenImage, null, Modifier.size(28.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(description, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
                            maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text(if (url == null) words("图片地址不可用", "Image address is unavailable")
                            else words("图片未能加载", "Image could not be loaded"),
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center)
                        if (url != null) TextButton({ attempt++ }, Modifier.heightIn(min = 48.dp)) {
                            Icon(Icons.Outlined.Refresh, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(words("重新加载图片", "Retry image"))
                        }
                    }
                    state !is AsyncImagePainter.State.Success -> Row(
                        Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Text(words("正在加载图片", "Loading image"), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

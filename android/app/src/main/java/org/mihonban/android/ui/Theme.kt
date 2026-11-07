package org.mihonban.android.ui

import android.content.res.Resources
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import org.mihonban.android.R

val BrandSerif = FontFamily(Font(R.font.shippori_mincho_semibold, FontWeight.SemiBold))

private val Colors = darkColorScheme(
    primary = Color(0xffe8542f), onPrimary = Color(0xff0d0b09),
    primaryContainer = Color(0xff542619), onPrimaryContainer = Color(0xffffd9c8),
    secondary = Color(0xffe3b34c), onSecondary = Color(0xff0d0b09),
    secondaryContainer = Color(0xff3b2a1b), onSecondaryContainer = Color(0xfff4ecdd),
    tertiary = Color(0xffb0a58f), onTertiary = Color(0xff0d0b09),
    tertiaryContainer = Color(0xff272219), onTertiaryContainer = Color(0xfff4ecdd),
    background = Color(0xff0d0b09), onBackground = Color(0xfff4ecdd),
    surface = Color(0xff16130f), onSurface = Color(0xfff4ecdd),
    surfaceVariant = Color(0xff272219), onSurfaceVariant = Color(0xffb0a58f),
    surfaceContainer = Color(0xff1e1a15), surfaceContainerHigh = Color(0xff272219),
    surfaceContainerHighest = Color(0xff272219), surfaceDim = Color(0xff0d0b09), surfaceBright = Color(0xff272219),
    surfaceContainerLow = Color(0xff16130f), surfaceContainerLowest = Color(0xff0d0b09),
    outline = Color(0xff8d8370), outlineVariant = Color(0xff2b251d),
    error = Color(0xffffb4ab), onError = Color(0xff690005),
)

private object BrandTypography {
    private var cached: Typography? = null

    @Synchronized
    fun get(resources: Resources): Typography {
        cached?.let { return it }
        // Font.Builder copies compressed font data into direct buffers. Share the font
        // family across activity recreations instead of retaining a new copy each time.
        val headings = if (android.os.Build.VERSION.SDK_INT >= 29) {
            val primary = android.graphics.fonts.FontFamily.Builder(
                android.graphics.fonts.Font.Builder(resources, R.font.shippori_mincho_semibold).build()).build()
            val fallback = android.graphics.fonts.FontFamily.Builder(
                android.graphics.fonts.Font.Builder(resources, R.font.genryu_mincho).build()).build()
            FontFamily(android.graphics.Typeface.CustomFallbackBuilder(primary)
                .addCustomFallback(fallback).setSystemFallback("serif").build())
        } else BrandSerif
        return Typography(
            headlineLarge = TextStyle(fontFamily = headings, fontWeight = FontWeight.SemiBold, fontSize = 32.sp),
            headlineMedium = TextStyle(fontFamily = headings, fontWeight = FontWeight.SemiBold, fontSize = 27.sp),
            titleLarge = TextStyle(fontFamily = headings, fontWeight = FontWeight.SemiBold, fontSize = 22.sp),
        ).also { cached = it }
    }
}

@Composable
fun MihonbanTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val typography = remember { BrandTypography.get(context.applicationContext.resources) }
    MaterialTheme(colorScheme = Colors, typography = typography, content = content)
}

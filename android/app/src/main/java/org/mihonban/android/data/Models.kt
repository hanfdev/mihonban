package org.mihonban.android.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

val CatalogJson = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

@Serializable
data class ArtistCredit(val name: String, val sort: String = "")

@Serializable
data class RymRating(
    val rating: Double? = null, val votes: Int? = null, val rank: String? = null,
    val rymUrl: String? = null, val genres: List<String> = emptyList(),
    val secondaryGenres: List<String> = emptyList(), val descriptors: List<String> = emptyList(),
) {
    val weighted: Double get() = rating?.takeIf { it.isFinite() && it in 0.0..5.0 }?.let {
        if (it <= 3.3) it else (it * (votes ?: 0).coerceAtLeast(0) + 165) / ((votes ?: 0).coerceAtLeast(0) + 50)
    } ?: -1.0
}

@Serializable
data class SimilarAlbum(
    val id: String, val title: String = "", val artist: String = "", val year: Int? = null,
    val rating: Double? = null, val votes: Int? = null,
)

@Serializable
data class Album(
    val id: String, val title: String = "", val artist: String = "", val artistSort: String = "",
    val artists: List<ArtistCredit> = emptyList(), val year: Int? = null,
    val trackCount: Int = 0, val duration: Double = 0.0,
    val genres: List<String> = emptyList(), val secondaryGenres: List<String> = emptyList(),
    @Serializable(with = FlexibleBooleanSerializer::class) val hidden: Boolean = false,
    val note: String = "", val rym: RymRating? = null, val tracks: List<Track> = emptyList(),
    val images: List<String> = emptyList(), val similar: List<SimilarAlbum> = emptyList(),
    val folder: String = "", val storageId: String = "", val createdAt: Long = 0, val updatedAt: Long = 0,
) {
    val credits: List<ArtistCredit> get() = artists.ifEmpty { listOf(ArtistCredit(artist, artistSort)) }
    val normalizedTracks: List<Track> get() = tracks.map { it.copy(
        albumId = id, albumTitle = title, artist = it.artist.ifBlank { artist },
        artists = it.artists.ifEmpty { credits }, year = it.year ?: year, hidden = hidden,
    ) }
}

typealias AlbumDetail = Album

@Serializable
data class Track(
    val id: String, val title: String = "", val duration: Double = 0.0, val format: String = "",
    val disc: Int = 1, val track: Int = 0, val albumId: String = "", val albumTitle: String = "",
    val artist: String = "", val artists: List<ArtistCredit> = emptyList(), val artistSort: String = "",
    val year: Int? = null, val addedAt: Long = 0,
    @Serializable(with = FlexibleBooleanSerializer::class) val hidden: Boolean = false,
    val bitrate: Double = 0.0, val size: Long = 0, val path: String = "",
    @Serializable(with = FlexibleBooleanSerializer::class) val hasCustomArtists: Boolean = false,
) {
    val credits: List<ArtistCredit> get() = artists.ifEmpty { listOf(ArtistCredit(artist, artistSort)) }
}

@Serializable
data class Artist(
    val name: String, val sort: String = "", val note: String = "", val hasAvatar: Boolean = false,
    val hasBio: Boolean = false, val aliases: List<String> = emptyList(),
    val featuredTrackCount: Int = 0, val visibleFeaturedTrackCount: Int = 0,
)

@Serializable
data class FavoriteItem(val id: String, val ts: Long = 0, val order: Int? = null)

@Serializable
data class Favorites(val albums: List<FavoriteItem> = emptyList(), val tracks: List<FavoriteItem> = emptyList())

@Serializable
data class Session(val ok: Boolean = false, val role: String = "", val guest: Boolean = false) {
    val isAdmin: Boolean get() = ok && role == "admin" && !guest
    val cacheRole: String get() = if (isAdmin) "admin" else if (ok) "listener" else "signed-out"
}

@Serializable
data class Catalog(
    val albums: List<Album> = emptyList(), val tracks: List<Track> = emptyList(),
    val artists: List<Artist> = emptyList(), val favorites: Favorites = Favorites(),
    val savedAt: Long = 0, val includesHidden: Boolean = false,
)

/** SQLite list endpoints may emit integer flags while detail endpoints emit booleans. */
object FlexibleBooleanSerializer : KSerializer<Boolean> {
    override val descriptor = PrimitiveSerialDescriptor("FlexibleBoolean", PrimitiveKind.BOOLEAN)
    override fun deserialize(decoder: Decoder): Boolean {
        val value = (decoder as JsonDecoder).decodeJsonElement() as? JsonPrimitive ?: return false
        return value.booleanOrNull ?: (value.intOrNull?.let { it != 0 } ?: false)
    }
    override fun serialize(encoder: Encoder, value: Boolean) = encoder.encodeBoolean(value)
}

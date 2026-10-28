use crate::cache::CacheStore;
use anyhow::{anyhow, Context, Result};
use reqwest::{Client, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::{Path, PathBuf},
};
use url::Url;

const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct LoginResponse {
    pub ok: bool,
    pub role: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MeResponse {
    pub ok: bool,
    pub role: Option<String>,
    #[serde(default)]
    pub guest: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Album {
    pub id: String,
    pub artist: String,
    #[serde(default, rename = "artistSort", alias = "artist_sort")]
    pub artist_sort: String,
    #[serde(default)]
    pub artists: Vec<ArtistCredit>,
    pub title: String,
    pub year: Option<i32>,
    #[serde(rename = "trackCount", default)]
    pub track_count: i32,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default, rename = "secondaryGenres")]
    pub secondary_genres: Vec<String>,
    #[serde(default)]
    pub rym: Option<RymData>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct RymData {
    pub rating: Option<f64>,
    #[serde(default)]
    pub votes: Option<u64>,
    #[serde(default)]
    pub rank: Option<String>,
    #[serde(default, rename = "rymUrl")]
    pub url: Option<String>,
    #[serde(default)]
    pub descriptors: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Artist {
    pub name: String,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub note: String,
    #[serde(default, rename = "hasAvatar")]
    pub has_avatar: bool,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default, rename = "visibleFeaturedTrackCount")]
    pub featured_track_count: usize,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Favorite {
    pub id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Favorites {
    #[serde(default)]
    pub albums: Vec<Favorite>,
    #[serde(default)]
    pub tracks: Vec<Favorite>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ArtistCredit {
    pub name: String,
    #[serde(default)]
    pub sort: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Track {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub disc: i32,
    #[serde(default)]
    pub track: Option<i32>,
    #[serde(default, rename = "albumId", alias = "album_id")]
    pub album_id: Option<String>,
    #[serde(rename = "albumTitle", default)]
    pub album_title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default, rename = "artistSort", alias = "artist_sort")]
    pub artist_sort: String,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default, rename = "addedAt", alias = "added_at")]
    pub added_at: i64,
    #[serde(default)]
    pub artists: Vec<ArtistCredit>,
    /// Audio bitrate in kilobits per second, matching the Mihonban API and Web client.
    #[serde(default)]
    pub bitrate: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AlbumDetail {
    #[serde(flatten)]
    pub album: Album,
    #[serde(default)]
    pub tracks: Vec<Track>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub similar: Vec<SimilarAlbum>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SimilarAlbum {
    pub id: String,
    #[serde(default)]
    pub artist: String,
    pub title: String,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub votes: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateManifest {
    pub latest: String,
    pub download_url: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub notes: String,
}

impl ApiClient {
    pub fn new(base_url: &str) -> Result<Self> {
        let mut url = Url::parse(base_url.trim()).context("service address is not a valid URL")?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(anyhow!("service address must use http or https"));
        }
        url.set_query(None);
        url.set_fragment(None);
        let base_url = url.to_string().trim_end_matches('/').to_owned();
        let client = Client::builder()
            .cookie_store(true)
            .user_agent(concat!("mihonban-native/", env!("CARGO_PKG_VERSION")))
            .build()
            .context("cannot create HTTP client")?;
        Ok(Self { client, base_url })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn json<T: DeserializeOwned>(&self, request: reqwest::RequestBuilder) -> Result<T> {
        let response = request.send().await.context("request failed")?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            return Err(anyhow!("server returned {status}: {message}"));
        }
        response.json().await.context("invalid server response")
    }

    pub async fn health(&self) -> Result<()> {
        let response = self.client.get(self.url("/api/health")).send().await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(anyhow!("health check returned {}", response.status()))
        }
    }

    pub async fn login(&self, password: &str) -> Result<LoginResponse> {
        self.json(
            self.client
                .post(self.url("/api/login"))
                .json(&serde_json::json!({"password": password})),
        )
        .await
    }

    pub async fn me(&self) -> Result<MeResponse> {
        let response = self.client.get(self.url("/api/me")).send().await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Ok(MeResponse {
                ok: false,
                role: None,
                guest: false,
            });
        }
        if !response.status().is_success() {
            return Err(anyhow!("server returned {}", response.status()));
        }
        response.json().await.context("invalid session response")
    }
    pub async fn library(&self, hidden: bool) -> Result<Vec<Album>> {
        let path = if hidden {
            "/api/library?hidden=1"
        } else {
            "/api/library"
        };
        self.json(self.client.get(self.url(path))).await
    }
    pub async fn tracks(&self, hidden: bool) -> Result<Vec<Track>> {
        let path = if hidden {
            "/api/tracks?hidden=1"
        } else {
            "/api/tracks"
        };
        self.json(self.client.get(self.url(path))).await
    }
    pub async fn album(&self, id: &str) -> Result<AlbumDetail> {
        let mut detail: AlbumDetail = self
            .json(
                self.client
                    .get(self.url(&format!("/api/album/{}", urlencoding(id)))),
            )
            .await?;
        for track in &mut detail.tracks {
            track.album_id = Some(detail.album.id.clone());
            track.album_title = detail.album.title.clone();
            if track.artist.trim().is_empty() {
                track.artist = detail.album.artist.clone();
            }
        }
        Ok(detail)
    }

    pub async fn artists(&self) -> Result<Vec<Artist>> {
        self.json(self.client.get(self.url("/api/artists"))).await
    }

    pub async fn favorites(&self) -> Result<Favorites> {
        self.json(self.client.get(self.url("/api/favorites"))).await
    }

    pub async fn set_favorite(&self, kind: &str, id: &str, enabled: bool) -> Result<()> {
        if !matches!(kind, "album" | "track") {
            return Err(anyhow!("favorite kind must be album or track"));
        }
        let path = format!("/api/favorites/{kind}/{}", urlencoding(id));
        let request = if enabled {
            self.client.put(self.url(&path))
        } else {
            self.client.delete(self.url(&path))
        };
        let response = request.send().await.context("favorite request failed")?;
        if !response.status().is_success() {
            let status = response.status();
            let message = response.text().await.unwrap_or_default();
            return Err(anyhow!("server returned {status}: {message}"));
        }
        Ok(())
    }

    pub async fn artist_bio(&self, name: &str) -> Result<String> {
        #[derive(Deserialize)]
        struct Bio {
            #[serde(default)]
            bio: String,
        }
        self.json::<Bio>(
            self.client
                .get(self.url(&format!("/api/artist-bio/{}", urlencoding(name)))),
        )
        .await
        .map(|response| response.bio)
    }

    pub async fn artist_art_cached(
        &self,
        name: &str,
        custom: bool,
        cache: &CacheStore,
    ) -> Result<Vec<u8>> {
        let key = format!("artist:{name}:{custom}");
        if let Some(path) = cache.get(&key) {
            return read_cached_image(&path).context("cannot read cached artist photo");
        }
        let response = self
            .client
            .get(self.url(&format!(
                "/api/artist-art/{}{}",
                urlencoding(name),
                if custom { "?v=c" } else { "" }
            )))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(anyhow!("artist photo returned {}", response.status()));
        }
        let bytes = read_image_response(response).await?;
        if cache.enabled() {
            let _ = cache.put_bytes(&key, "img", &bytes)?;
        }
        Ok(bytes)
    }
    pub async fn stream_to_cache(
        &self,
        id: &str,
        extension: &str,
        cache: &CacheStore,
    ) -> Result<PathBuf> {
        let generation = cache.generation();
        let mut clear_events = cache.clear_receiver();
        let key = format!("audio:{id}");
        if let Some(path) = cache.get(&key) {
            return Ok(path);
        }
        let response = self
            .client
            .get(self.url(&format!("/api/stream/{}", urlencoding(id))))
            .send()
            .await?;
        if response.status() != StatusCode::OK && response.status() != StatusCode::PARTIAL_CONTENT {
            return Err(anyhow!("audio request returned {}", response.status()));
        }
        anyhow::ensure!(
            !cache.enabled() || cache.generation_is_current(generation),
            "cache was cleared during the download"
        );
        let extension = extension.trim_start_matches('.');
        let temp = cache.temporary_path_at_generation(&key, extension, generation)?;
        if let Some(parent) = temp.parent() {
            if let Err(error) =
                std::fs::create_dir_all(parent).context("cannot create cache directory")
            {
                let _ = cache.discard_temp(&temp);
                return Err(error);
            }
        }
        let download = async {
            let mut file =
                std::fs::File::create(&temp).context("cannot create cache audio file")?;
            let mut response = response;
            loop {
                let chunk = if cache.enabled() {
                    tokio::select! {
                        result = response.chunk() => result.context("audio download interrupted")?,
                        changed = clear_events.changed() => {
                            let _ = changed;
                            anyhow::bail!("cache was cleared during the download");
                        }
                    }
                } else {
                    response
                        .chunk()
                        .await
                        .context("audio download interrupted")?
                };
                let Some(chunk) = chunk else {
                    break;
                };
                std::io::Write::write_all(&mut file, &chunk)
                    .context("cannot write cache audio file")?;
            }
            std::io::Write::flush(&mut file).context("cannot flush cache audio file")?;
            anyhow::ensure!(
                !cache.enabled() || cache.generation_is_current(generation),
                "cache was cleared during the download"
            );
            Ok::<_, anyhow::Error>(())
        }
        .await;
        if let Err(error) = download {
            let _ = cache.discard_temp(&temp);
            return Err(error);
        }
        if cache.enabled() {
            cache.commit_temp_at_generation(&key, extension, &temp, generation)
        } else {
            Ok(temp)
        }
    }

    pub async fn cover_cached(&self, id: &str, cache: &CacheStore) -> Result<Vec<u8>> {
        let key = format!("cover:{id}");
        if let Some(path) = cache.get(&key) {
            return read_cached_image(&path).context("cannot read cached cover");
        }
        let bytes = self.cover(id).await?;
        if cache.enabled() {
            let _ = cache.put_bytes(&key, "img", &bytes)?;
        }
        Ok(bytes)
    }

    pub async fn cover(&self, id: &str) -> Result<Vec<u8>> {
        let response = self
            .client
            .get(self.url(&format!("/api/art/{}?s=480", urlencoding(id))))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(anyhow!("cover request returned {}", response.status()));
        }
        read_image_response(response).await
    }

    pub async fn image_cached(&self, id: &str, size: u32, cache: &CacheStore) -> Result<Vec<u8>> {
        let key = format!("image:{id}:{size}");
        if let Some(path) = cache.get(&key) {
            return read_cached_image(&path).context("cannot read cached album image");
        }
        let response = self
            .client
            .get(self.url(&format!("/api/image/{}?s={size}", urlencoding(id))))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "album image request returned {}",
                response.status()
            ));
        }
        let bytes = read_image_response(response).await?;
        if cache.enabled() {
            let _ = cache.put_bytes(&key, "img", &bytes)?;
        }
        Ok(bytes)
    }
}

pub fn admin_console_url(base_url: &str) -> Result<String> {
    let mut url = Url::parse(base_url.trim()).context("service address is not a valid URL")?;
    if !matches!(url.scheme(), "http" | "https") || !url.has_host() {
        return Err(anyhow!("service address must use http or https"));
    }
    let path = url.path().trim_end_matches('/');
    url.set_path(&format!("{path}/"));
    url.set_query(None);
    url.set_fragment(Some("/admin"));
    Ok(url.to_string())
}

async fn read_image_response(mut response: reqwest::Response) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_IMAGE_BYTES as u64)
    {
        return Err(anyhow!("image exceeds the 32 MiB download limit"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .context("image download interrupted")?
    {
        // Content-Length may be absent or inaccurate, so enforce the limit on every chunk.
        if chunk.len() > MAX_IMAGE_BYTES.saturating_sub(bytes.len()) {
            return Err(anyhow!("image exceeds the 32 MiB download limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn read_cached_image(path: &Path) -> Result<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    if file.metadata()?.len() > MAX_IMAGE_BYTES as u64 {
        return Err(anyhow!("cached image exceeds the 32 MiB limit"));
    }
    let mut bytes = Vec::new();
    // Bound the read as well as metadata, in case another process grows the file.
    file.take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(anyhow!("cached image exceeds the 32 MiB limit"));
    }
    Ok(bytes)
}

fn urlencoding(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, percent_encoding::NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::ApiClient;

    #[test]
    fn service_urls_are_normalized_and_validated() {
        let client = ApiClient::new("https://music.example.test///?old=1#fragment").unwrap();
        assert_eq!(client.base_url, "https://music.example.test");
        assert!(ApiClient::new("file:///music").is_err());
        assert!(ApiClient::new("not a url").is_err());
    }

    #[test]
    fn path_values_use_percent_encoding_instead_of_form_plus_encoding() {
        assert_eq!(super::urlencoding("Michael Franks"), "Michael%20Franks");
        assert_eq!(super::urlencoding("C++ / 夜"), "C%2B%2B%20%2F%20%E5%A4%9C");
    }

    #[test]
    fn admin_console_url_preserves_a_deployment_path() {
        assert_eq!(
            super::admin_console_url("https://music.example.test/mihon/?old=1#tracks").unwrap(),
            "https://music.example.test/mihon/#/admin"
        );
        assert!(super::admin_console_url("file:///music").is_err());
    }

    #[test]
    fn cached_images_are_checked_before_loading_the_file() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"small image").unwrap();
        assert_eq!(
            super::read_cached_image(file.path()).unwrap(),
            b"small image"
        );
        file.as_file()
            .set_len(super::MAX_IMAGE_BYTES as u64 + 1)
            .unwrap();
        assert!(super::read_cached_image(file.path()).is_err());
    }
}

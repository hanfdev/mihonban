use anyhow::{bail, Context, Result};
use eframe::egui::ColorImage;
use image::{imageops::FilterType, DynamicImage, ImageReader, Limits, RgbaImage};
use std::io::Cursor;

const COVER_EDGE: u32 = 512;
const GALLERY_EDGE: u32 = 2048;
const MAX_ENCODED_BYTES: usize = 32 * 1024 * 1024;
const MAX_DECODED_BYTES: u64 = 24 * 1024 * 1024;

pub(super) struct PreparedArtwork {
    pub original: ColorImage,
    pub muted: Option<ColorImage>,
    pub backdrop: ColorImage,
}

// These CPU-heavy functions run on the bounded image worker, never on the UI thread.
pub(super) fn prepare_artwork(bytes: &[u8], shaded: bool) -> Result<PreparedArtwork> {
    let decoded = decode_bounded(bytes)?;
    let original = fit_within(decoded, COVER_EDGE);
    let backdrop = original
        .resize_exact(64, 64, FilterType::Triangle)
        .blur(12.0)
        .into_rgba8();
    let original = original.into_rgba8();
    let muted = shaded.then(|| {
        let mut muted = original.clone();
        for pixel in muted.pixels_mut() {
            let luminance =
                pixel[0] as f32 * 0.2126 + pixel[1] as f32 * 0.7152 + pixel[2] as f32 * 0.0722;
            for channel in &mut pixel.0[..3] {
                *channel = ((luminance * 0.08 + *channel as f32 * 0.92) * 0.88) as u8;
            }
        }
        color_image(muted)
    });
    Ok(PreparedArtwork {
        original: color_image(original),
        muted,
        backdrop: color_image(backdrop),
    })
}

pub(super) fn prepare_gallery(bytes: &[u8]) -> Result<ColorImage> {
    let decoded = decode_bounded(bytes)?;
    Ok(color_image(fit_within(decoded, GALLERY_EDGE).into_rgba8()))
}

fn decode_bounded(bytes: &[u8]) -> Result<DynamicImage> {
    if bytes.len() > MAX_ENCODED_BYTES {
        bail!("image exceeds the 32 MiB download limit");
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .context("cannot identify image format")?;
    reader.limits(limits);
    reader
        .decode()
        .context("cannot decode image within resource limits")
}

fn fit_within(decoded: DynamicImage, maximum: u32) -> DynamicImage {
    if decoded.width().max(decoded.height()) > maximum {
        decoded.resize(maximum, maximum, FilterType::Triangle)
    } else {
        decoded
    }
}

fn color_image(rgba: RgbaImage) -> ColorImage {
    ColorImage::from_rgba_unmultiplied(
        [rgba.width() as usize, rgba.height() as usize],
        rgba.as_raw(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgba};

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            width,
            height,
            Rgba([180, 90, 45, 255]),
        ));
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, ImageFormat::Png).unwrap();
        output.into_inner()
    }

    #[test]
    fn cover_textures_are_bounded_and_keep_the_original_aspect_ratio() {
        for (width, height, expected) in [
            (2048, 1024, [512, 256]),
            (1024, 2048, [256, 512]),
            (1024, 1024, [512, 512]),
        ] {
            let artwork = prepare_artwork(&png(width, height), true).unwrap();
            assert_eq!(artwork.original.size, expected);
            assert_eq!(artwork.muted.as_ref().unwrap().size, expected);
            assert_eq!(artwork.backdrop.size, [64, 64]);
            assert!(artwork.original.pixels.len() * 4 <= 1024 * 1024);
        }
    }

    #[test]
    fn small_artwork_is_not_upscaled_or_stretched() {
        let artwork = prepare_artwork(&png(120, 80), true).unwrap();
        assert_eq!(artwork.original.size, [120, 80]);
        assert_eq!(artwork.original.pixels[0].to_array(), [180, 90, 45, 255]);
    }

    #[test]
    fn cover_shading_preserves_the_original_desaturation_and_brightness() {
        let artwork = prepare_artwork(&png(120, 80), true).unwrap();
        assert_eq!(artwork.original.pixels[0].to_array(), [180, 90, 45, 255]);
        assert_eq!(
            artwork.muted.unwrap().pixels[0].to_array(),
            [153, 80, 43, 255]
        );
    }

    #[test]
    fn artist_artwork_does_not_allocate_a_muted_copy() {
        let artwork = prepare_artwork(&png(120, 80), false).unwrap();
        assert!(artwork.muted.is_none());
        assert_eq!(artwork.original.size, [120, 80]);
        assert_eq!(artwork.original.pixels[0].to_array(), [180, 90, 45, 255]);
    }

    #[test]
    fn gallery_resolution_remains_suitable_for_a_large_lightbox() {
        let gallery = prepare_gallery(&png(3072, 1536)).unwrap();
        assert_eq!(gallery.size, [2048, 1024]);
        let small = prepare_gallery(&png(300, 480)).unwrap();
        assert_eq!(small.size, [300, 480]);
    }

    #[test]
    fn oversized_dimensions_are_rejected_before_decoding_pixels() {
        assert!(prepare_artwork(&png(16_385, 1), true).is_err());
    }

    #[test]
    fn malformed_images_fail_without_retaining_texture_data() {
        assert!(prepare_artwork(b"not an image", false).is_err());
        assert!(prepare_gallery(b"not an image").is_err());
    }
}

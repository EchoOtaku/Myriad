//! Local sticker cutout: if the generator left an opaque backdrop, flood-fill
//! similar border color to alpha 0 and emit PNG. Not a neural matting model.

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use std::io::Cursor;
use std::sync::{Arc, LazyLock};
use tokio::sync::Semaphore;

const MAX_STICKER_EDGE: u32 = 4096;
const MAX_STICKER_PIXELS: u64 = 2048 * 2048;
const MAX_DECODE_ALLOC: u64 = 64 * 1024 * 1024;
static STICKER_WORKERS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(2)));

#[derive(Debug)]
pub enum StickerProcessingError {
    Busy,
    Invalid(String),
    WorkerFailed,
}

pub async fn prepare_sticker_png(bytes: Vec<u8>) -> Result<Vec<u8>, StickerProcessingError> {
    process_with_pool(STICKER_WORKERS.clone(), move || ensure_sticker_png(&bytes)).await
}

pub async fn inspect_sticker_upload(
    bytes: Vec<u8>,
) -> Result<(Vec<u8>, (u32, u32)), StickerProcessingError> {
    process_with_pool(STICKER_WORKERS.clone(), move || {
        let dimensions = sticker_dimensions(&bytes)?;
        Ok((bytes, dimensions))
    })
    .await
}

async fn process_with_pool<T: Send + 'static>(
    pool: Arc<Semaphore>,
    process: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, StickerProcessingError> {
    // Reject excess work rather than retaining an unbounded queue of images.
    let permit = pool
        .try_acquire_owned()
        .map_err(|_| StickerProcessingError::Busy)?;
    tokio::task::spawn_blocking(move || {
        // Cancellation of the HTTP handler must not release a running worker's slot.
        let _permit = permit;
        process().map_err(StickerProcessingError::Invalid)
    })
    .await
    .map_err(|_| StickerProcessingError::WorkerFailed)?
}

fn sticker_reader(bytes: &[u8]) -> Result<image::ImageReader<Cursor<&[u8]>>, String> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_STICKER_EDGE);
    limits.max_image_height = Some(MAX_STICKER_EDGE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    Ok(reader)
}

fn sticker_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let (width, height) = sticker_reader(bytes)?
        .into_dimensions()
        .map_err(|error| error.to_string())?;
    if width == 0
        || height == 0
        || width > MAX_STICKER_EDGE
        || height > MAX_STICKER_EDGE
        || u64::from(width) * u64::from(height) > MAX_STICKER_PIXELS
    {
        return Err("sticker dimensions exceed supported limits".to_string());
    }
    Ok((width, height))
}

const ALPHA_OPAQUE: u8 = 250;
const BG_DIST2: u32 = 48 * 48 * 3;
const MIN_OPAQUE_RATIO: f32 = 0.01;
const USEFUL_ALPHA_RATIO: f32 = 0.02;

pub fn ensure_sticker_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.is_empty() {
        return Err("generated sticker is empty".to_string());
    }
    sticker_dimensions(bytes)?;
    let decoded = sticker_reader(bytes)?
        .decode()
        .map_err(|error| error.to_string())?;
    let mut rgba = decoded.into_rgba8();
    if !has_useful_alpha(&rgba) {
        cut_border_background(&mut rgba);
    }
    encode_png(&rgba)
}

fn has_useful_alpha(image: &RgbaImage) -> bool {
    let total = image.width().saturating_mul(image.height()) as usize;
    if total == 0 {
        return false;
    }
    let transparent = image
        .pixels()
        .filter(|pixel| pixel[3] < ALPHA_OPAQUE)
        .count();
    (transparent as f32 / total as f32) >= USEFUL_ALPHA_RATIO
}

fn average_border_rgb(image: &RgbaImage) -> Rgba<u8> {
    let w = image.width();
    let h = image.height();
    let corners = [
        *image.get_pixel(0, 0),
        *image.get_pixel(w.saturating_sub(1), 0),
        *image.get_pixel(0, h.saturating_sub(1)),
        *image.get_pixel(w.saturating_sub(1), h.saturating_sub(1)),
    ];
    let sum = corners.iter().fold([0u32; 3], |acc, pixel| {
        [
            acc[0] + u32::from(pixel[0]),
            acc[1] + u32::from(pixel[1]),
            acc[2] + u32::from(pixel[2]),
        ]
    });
    Rgba([
        (sum[0] / 4) as u8,
        (sum[1] / 4) as u8,
        (sum[2] / 4) as u8,
        255,
    ])
}

fn color_dist2(left: Rgba<u8>, right: Rgba<u8>) -> u32 {
    let dr = i32::from(left[0]) - i32::from(right[0]);
    let dg = i32::from(left[1]) - i32::from(right[1]);
    let db = i32::from(left[2]) - i32::from(right[2]);
    (dr * dr + dg * dg + db * db) as u32
}

fn cut_border_background(image: &mut RgbaImage) {
    let original = image.clone();
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        return;
    }
    let background = average_border_rgb(image);
    let mut seen = vec![false; (width * height) as usize];
    let mut stack: Vec<(u32, u32)> = Vec::new();
    // Mark on enqueue so each pixel occupies at most one stack entry.
    let mut enqueue = |stack: &mut Vec<(u32, u32)>, x: u32, y: u32| {
        let i = (y * width + x) as usize;
        if !seen[i] {
            seen[i] = true;
            stack.push((x, y));
        }
    };

    for x in 0..width {
        enqueue(&mut stack, x, 0);
        if height > 1 {
            enqueue(&mut stack, x, height - 1);
        }
    }
    for y in 1..height.saturating_sub(1) {
        enqueue(&mut stack, 0, y);
        if width > 1 {
            enqueue(&mut stack, width - 1, y);
        }
    }

    while let Some((x, y)) = stack.pop() {
        let pixel = *image.get_pixel(x, y);
        if color_dist2(pixel, background) > BG_DIST2 {
            continue;
        }
        image.put_pixel(x, y, Rgba([pixel[0], pixel[1], pixel[2], 0]));
        if x > 0 {
            enqueue(&mut stack, x - 1, y);
        }
        if x + 1 < width {
            enqueue(&mut stack, x + 1, y);
        }
        if y > 0 {
            enqueue(&mut stack, x, y - 1);
        }
        if y + 1 < height {
            enqueue(&mut stack, x, y + 1);
        }
    }

    let total = (width * height) as f32;
    let opaque = image.pixels().filter(|pixel| pixel[3] > 0).count() as f32;
    if total > 0.0 && opaque / total < MIN_OPAQUE_RATIO {
        *image = original;
        return;
    }

    drop(original);
    drop(seen);
    drop(stack);
    feather_edges(image, background);
}

fn feather_edges(image: &mut RgbaImage, background: Rgba<u8>) {
    let width = image.width();
    let height = image.height();
    let snapshot = image.clone();
    for y in 0..height {
        for x in 0..width {
            let pixel = *snapshot.get_pixel(x, y);
            if pixel[3] == 0 {
                continue;
            }
            let neighbor_clear = (x > 0 && snapshot.get_pixel(x - 1, y)[3] == 0)
                || (x + 1 < width && snapshot.get_pixel(x + 1, y)[3] == 0)
                || (y > 0 && snapshot.get_pixel(x, y - 1)[3] == 0)
                || (y + 1 < height && snapshot.get_pixel(x, y + 1)[3] == 0);
            if !neighbor_clear {
                continue;
            }
            let dist = color_dist2(pixel, background).min(BG_DIST2);
            let alpha = ((dist * 255) / BG_DIST2.max(1)) as u8;
            image.put_pixel(x, y, Rgba([pixel[0], pixel[1], pixel[2], alpha.max(32)]));
        }
    }
}

fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    DynamicImage::ImageRgba8(image.clone())
        .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{ensure_sticker_png, has_useful_alpha};
    use image::{Rgba, RgbaImage};

    fn encode(image: &RgbaImage) -> Vec<u8> {
        super::encode_png(image).expect("png")
    }

    #[tokio::test]
    async fn upload_inspection_preserves_bytes_and_reads_dimensions() {
        let bytes = encode(&RgbaImage::from_pixel(24, 12, Rgba([5, 10, 15, 255])));
        let (stored, dimensions) = super::inspect_sticker_upload(bytes.clone()).await.unwrap();
        assert_eq!(stored, bytes);
        assert_eq!(dimensions, (24, 12));
    }

    #[tokio::test]
    async fn cancelled_sticker_request_keeps_worker_slot_until_cpu_work_ends() {
        use super::{StickerProcessingError, process_with_pool};
        use std::sync::Arc;
        use std::time::Duration;
        use tokio::sync::{Semaphore, oneshot};

        let pool = Arc::new(Semaphore::new(1));
        let (started_tx, started_rx) = oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let job_pool = pool.clone();
        let request = tokio::spawn(async move {
            process_with_pool(job_pool, move || {
                let _ = started_tx.send(());
                let _ = release_rx.recv();
                Ok(())
            })
            .await
        });
        tokio::time::timeout(Duration::from_secs(5), started_rx)
            .await
            .unwrap()
            .unwrap();
        request.abort();
        let _ = request.await;
        // The blocking task survived cancellation, so a replacement must not start.
        let rejected = tokio::time::timeout(
            Duration::from_secs(5),
            process_with_pool(pool.clone(), || Ok(())),
        )
        .await;
        release_tx.send(()).unwrap();
        assert!(matches!(rejected, Ok(Err(StickerProcessingError::Busy))));
        let _permit = tokio::time::timeout(Duration::from_secs(5), pool.acquire_owned())
            .await
            .unwrap()
            .unwrap();
    }

    #[test]
    fn rejects_sticker_dimensions_above_edge_budget() {
        // Tiny compressed PNG but an unsupported canvas; reject before cutout.
        let wide = RgbaImage::from_pixel(4097, 1, Rgba([0, 0, 0, 0]));
        assert!(ensure_sticker_png(&encode(&wide)).is_err());
    }

    #[test]
    fn rejects_sticker_pixel_budget_even_with_supported_edges() {
        let too_many_pixels = RgbaImage::from_pixel(2049, 2048, Rgba([0, 0, 0, 0]));
        let error = ensure_sticker_png(&encode(&too_many_pixels)).unwrap_err();
        assert!(error.contains("dimensions"));
    }

    #[test]
    fn cuts_solid_white_around_a_red_subject() {
        let mut image = RgbaImage::from_pixel(32, 32, Rgba([255, 255, 255, 255]));
        for y in 10..22 {
            for x in 10..22 {
                image.put_pixel(x, y, Rgba([220, 20, 20, 255]));
            }
        }
        let png = ensure_sticker_png(&encode(&image)).expect("cutout");
        let out = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(out.get_pixel(0, 0)[3], 0);
        assert_eq!(out.get_pixel(31, 31)[3], 0);
        assert!(out.get_pixel(16, 16)[3] > 200);
        assert!(out.get_pixel(16, 16)[0] > 180);
    }

    #[test]
    fn keeps_existing_alpha() {
        let mut image = RgbaImage::from_pixel(8, 8, Rgba([0, 0, 0, 0]));
        image.put_pixel(3, 3, Rgba([10, 200, 10, 255]));
        assert!(has_useful_alpha(&image));
        let png = ensure_sticker_png(&encode(&image)).expect("keep");
        let out = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(out.get_pixel(0, 0)[3], 0);
        assert_eq!(out.get_pixel(3, 3)[3], 255);
    }

    #[test]
    fn rejects_empty_bytes() {
        assert!(ensure_sticker_png(&[]).is_err());
    }
}

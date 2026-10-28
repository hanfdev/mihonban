use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |value: &str| {
        value
            .trim_start_matches('v')
            .split('.')
            .map(|n| n.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let a = parse(latest);
    let b = parse(current);
    let length = a.len().max(b.len());
    for index in 0..length {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        if left != right {
            return left > right;
        }
    }
    false
}

pub async fn download_and_verify(url: &str, expected_sha256: &str) -> Result<PathBuf> {
    let name = url
        .rsplit('/')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or("mihonban-update.exe");
    let path = std::env::temp_dir().join(format!("mihonban-{name}"));
    let partial = std::env::temp_dir().join(format!("mihonban-{name}.part"));
    let mut response = reqwest::get(url).await.context("update download failed")?;
    anyhow::ensure!(
        response.status().is_success(),
        "update download returned {}",
        response.status()
    );
    // Stream the payload straight to disk while hashing it, so the installer
    // never has to fit in memory.
    let mut file = fs::File::create(&partial).context("cannot create the update file")?;
    let mut hasher = Sha256::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .context("update download interrupted")?
    {
        hasher.update(&chunk);
        file.write_all(&chunk).context("cannot write the update file")?;
    }
    file.flush().context("cannot flush the update file")?;
    // Close the handle before renaming: Windows refuses to rename an open file.
    drop(file);
    if !expected_sha256.trim().is_empty() {
        let digest = format!("{:x}", hasher.finalize());
        if !digest.eq_ignore_ascii_case(expected_sha256.trim()) {
            let _ = fs::remove_file(&partial);
            return Err(anyhow!(
                "downloaded update checksum does not match the update manifest"
            ));
        }
    }
    let _ = fs::remove_file(&path);
    fs::rename(&partial, &path).context("cannot save downloaded update")?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn compares_numeric_versions_by_component() {
        assert!(is_newer("1.10.0", "1.9.9"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("0.9.9", "1.0.0"));
        assert!(is_newer("v2.0", "1.99.99"));
    }
}

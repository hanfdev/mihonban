"""Apply the reviewed playback fixes to the exact pinned engine checkout."""
import hashlib
from pathlib import Path
import stat
import subprocess
import sys

REVISION = "8455c970de34a63422857c4b4d6fffc85b822b47"
SOURCE_SHA256 = "7a64a6404dc4730f122d45881892d3988a4caaaa886b8b06eb2ebe2fa3faed60"
SOURCE = Path("Sources/CSFBAudioEngine/Decoders/SFBFLACDecoder.mm")
BEFORE = b"""        // Decode the next FLAC frame
        if (!FLAC__stream_decoder_process_single(_flac.get())) {"""
AFTER = b"""        // libFLAC reports success for ABORTED. Surface the read failure instead
        // of repeatedly decoding zero frames after a terminal network error.
        if (!FLAC__stream_decoder_process_single(_flac.get()) ||
            FLAC__stream_decoder_get_state(_flac.get()) == FLAC__STREAM_DECODER_ABORTED) {"""
PLAYER_SOURCE_SHA256 = "4629d6b6ec20ae75d104880146e07067575642dd11b30b504b7d8f54146d6d89"
PLAYER_SOURCE = Path("Sources/CSFBAudioEngine/Player/AudioPlayer.mm")
PLAYER_REPLACEMENTS = (
    (b"""    /// The number of frames decoded
    int64_t framesDecoded_{0};""",
     b"""    /// Whether this decoder has ever contributed to the shared buffers (decoder thread only).
    bool hasEnqueuedChunks_{false};
    /// The number of frames decoded
    int64_t framesDecoded_{0};"""),
    (b"""        if (bits::is_set(decoderFlags, DecoderState::Flags::decodingStarted)) {
            // Empty the ring buffer since the decoder could have contributed stale frames""",
     b"""        if (bits::is_set(decoderFlags, DecoderState::Flags::decodingStarted) && decoderState->hasEnqueuedChunks_) {
            // Preserve the current track's buffered tail when a prefetched decoder
            // fails before contributing any audio or EOF descriptor.
            // Empty the ring buffer since the decoder could have contributed stale frames"""),
    (b"""        // Write the decoded audio to the audio buffer for rendering
        const auto framesWritten = audioBuffer_.write(*(buffer.audioBufferList), framesDecoded);""",
     b"""        // Include empty EOF descriptors and conservatively retain cancellation
        // cleanup even if metadata push failed but the audio write can succeed.
        // Never reset this flag on seek: prior chunks may still be buffered.
        decoderState->hasEnqueuedChunks_ = true;

        // Write the decoded audio to the audio buffer for rendering
        const auto framesWritten = audioBuffer_.write(*(buffer.audioBufferList), framesDecoded);"""),
)


def patched_source(data):
    if hashlib.sha256(data).hexdigest() == SOURCE_SHA256:
        if data.count(BEFORE) != 1:
            raise RuntimeError("Pinned FLAC decoder does not contain the expected decode loop")
        return data.replace(BEFORE, AFTER, 1)
    # Accept only our exact patch on the same original bytes, never a similar
    # looking replacement in an upgraded or independently modified dependency.
    if data.count(AFTER) == 1:
        original = data.replace(AFTER, BEFORE, 1)
        if hashlib.sha256(original).hexdigest() == SOURCE_SHA256:
            return data
    raise RuntimeError("Unrecognized FLAC decoder source; review the pinned dependency before building")


def patched_player_source(data):
    original = data
    if hashlib.sha256(original).hexdigest() != PLAYER_SOURCE_SHA256:
        # Reverse only the complete exact patch. Partial or unrelated changes
        # must be reviewed instead of being silently merged into the build.
        for before, after in reversed(PLAYER_REPLACEMENTS):
            if original.count(after) != 1:
                raise RuntimeError("Unrecognized audio player source; review the pinned dependency before building")
            original = original.replace(after, before, 1)
        if hashlib.sha256(original).hexdigest() != PLAYER_SOURCE_SHA256:
            raise RuntimeError("Unrecognized audio player source; review the pinned dependency before building")
        return data
    for before, after in PLAYER_REPLACEMENTS:
        if data.count(before) != 1:
            raise RuntimeError("Pinned audio player does not contain the expected cancellation path")
        data = data.replace(before, after, 1)
    return data


def main():
    checkout = Path(sys.argv[1]).resolve()
    revision = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise RuntimeError("SFBAudioEngine revision changed; review the playback fixes before building")
    changes = []
    # Validate every source before modifying any file in the checkout.
    for source, patch in ((SOURCE, patched_source), (PLAYER_SOURCE, patched_player_source)):
        path = checkout / source
        original = path.read_bytes()
        changes.append((path, original, patch(original)))
    for path, original, patched in changes:
        if patched != original:
            # SwiftPM makes package sources read-only. Only the verified source
            # needs temporary owner write permission; preserve all original bits.
            mode = stat.S_IMODE(path.stat().st_mode)
            try:
                path.chmod(mode | stat.S_IWUSR)
                path.write_bytes(patched)
            finally:
                path.chmod(mode)
    print("Verified pinned SFBAudioEngine FLAC abort handling")
    print("Verified pinned SFBAudioEngine prefetch cancellation buffer handling")


if __name__ == "__main__":
    main()

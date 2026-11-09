"""Apply the reviewed FLAC abort fix to the exact pinned engine checkout."""
import hashlib
from pathlib import Path
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


def main():
    checkout = Path(sys.argv[1]).resolve()
    revision = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise RuntimeError("SFBAudioEngine revision changed; review the FLAC abort fix before building")
    path = checkout / SOURCE
    original = path.read_bytes()
    patched = patched_source(original)
    if patched != original:
        path.write_bytes(patched)
    print("Verified pinned SFBAudioEngine FLAC abort handling")


if __name__ == "__main__":
    main()

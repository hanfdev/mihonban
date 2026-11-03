#import "MBDecoderNames.h"

SFBAudioDecoderName MBDecoderNameForExtension(NSString *extension) {
    NSString *ext = extension.lowercaseString;
    if ([ext isEqualToString:@"flac"]) return SFBAudioDecoderNameFLAC;
    if ([ext isEqualToString:@"ogg"]) return SFBAudioDecoderNameOggVorbis;
    if ([ext isEqualToString:@"oga"]) return SFBAudioDecoderNameOggFLAC;
    if ([ext isEqualToString:@"opus"]) return SFBAudioDecoderNameOggOpus;
    // Core Audio decodes MP3 without the whole-file scan the mpg123 decoder
    // performs, so progressive playback can start before the download ends.
    return SFBAudioDecoderNameCoreAudio;
}

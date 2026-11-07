#import <SFBAudioEngine/SFBAudioDecoder.h>

NS_ASSUME_NONNULL_BEGIN

// SFBAudioEngine matches decoder names by pointer identity, so Swift must pass
// the library's own constants rather than equal strings.
FOUNDATION_EXPORT SFBAudioDecoderName MBDecoderNameForExtension(NSString *extension);

NS_ASSUME_NONNULL_END

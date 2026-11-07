#import <SFBAudioEngine/SFBInputSource.h>

NS_ASSUME_NONNULL_BEGIN

// All blocking reads run on a decoder queue, never on the main or render thread.
@interface MBHTTPInputSource : SFBInputSource
- (instancetype)initWithRemoteURL:(NSURL *)url cacheURL:(NSURL *)cacheURL;
/// A non-persistent source still streams progressively, but its growing file
/// is only a playback buffer and is removed when the source is closed.
- (instancetype)initWithRemoteURL:(NSURL *)url cacheURL:(NSURL *)cacheURL persistent:(BOOL)persistent;
- (void)cancel;
/// Restricted requests cannot migrate to cellular, metered or Low Data Mode paths.
@property(nonatomic) BOOL unmeteredOnly;
@property(nonatomic, readonly) double downloadedFraction;
@end

NS_ASSUME_NONNULL_END

#import <SFBAudioEngine/SFBInputSource.h>

NS_ASSUME_NONNULL_BEGIN

// All blocking reads run on a decoder queue, never on the main or render thread.
@interface MBHTTPInputSource : SFBInputSource
- (instancetype)initWithRemoteURL:(NSURL *)url cacheURL:(NSURL *)cacheURL;
- (void)cancel;
@property(nonatomic, readonly) double downloadedFraction;
@end

NS_ASSUME_NONNULL_END

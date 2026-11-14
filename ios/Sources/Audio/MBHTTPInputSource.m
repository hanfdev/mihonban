#import "MBHTTPInputSource.h"
#import <fcntl.h>
#import <unistd.h>

// SFBAudioEngine exposes its subclass initializer internally. Keep the package
// pinned and cover this narrow adapter in decoder integration tests.
@interface SFBInputSource (MihonbanSubclassing)
- (instancetype)initWithURL:(NSURL *)url;
@end

@interface MBHTTPInputSource () <NSURLSessionDataDelegate> {
    NSCondition *_condition;
    NSURL *_remoteURL;
    NSURL *_cacheURL;
    NSURL *_partialURL;
    NSURLSession *_session;
    NSURLSessionDataTask *_task;
    NSMutableIndexSet *_available;
    NSError *_failure;
    NSInteger _offset;
    NSInteger _length;
    NSInteger _writeOffset;
    NSInteger _requestedOffset;
    int _fd;
    BOOL _opened;
    BOOL _cancelled;
    BOOL _complete;
    BOOL _receivedResponse;
    BOOL _rangeSupported;
    BOOL _persistent;
    BOOL _unmeteredOnly;
    BOOL _requiresCompleteReads;
    BOOL _retryPending;
    NSUInteger _retryGeneration;
    NSUInteger _retryAttempt;
    NSTimeInterval _recoveryDeadline;
    NSTimeInterval _lastProgressTime;
    NSError *_transportError;
}
@end

@implementation MBHTTPInputSource

- (instancetype)initWithRemoteURL:(NSURL *)url cacheURL:(NSURL *)cacheURL {
    return [self initWithRemoteURL:url cacheURL:cacheURL persistent:YES];
}

- (instancetype)initWithRemoteURL:(NSURL *)url cacheURL:(NSURL *)cacheURL persistent:(BOOL)persistent {
    if ((self = [super initWithURL:cacheURL])) {
        _persistent = persistent;
        _remoteURL = url;
        _cacheURL = cacheURL;
        // MediaPaths retains the format extension even for hashed cache names.
        // MP3 uses Core Audio file callbacks; FLAC/Vorbis consume short reads.
        _requiresCompleteReads = [cacheURL.pathExtension.lowercaseString isEqualToString:@"mp3"];
        _partialURL = [cacheURL URLByAppendingPathExtension:[NSUUID.UUID.UUIDString stringByAppendingString:@".part"]];
        _condition = [[NSCondition alloc] init];
        _available = [[NSMutableIndexSet alloc] init];
        _length = -1;
        _fd = -1;
        _rangeSupported = YES;
    }
    return self;
}

- (void)dealloc {
    if (_fd >= 0) close(_fd);
    if (!_complete || !_persistent) [NSFileManager.defaultManager removeItemAtURL:_partialURL error:nil];
}

- (BOOL)openReturningError:(NSError **)error {
    [_condition lock];
    if (_opened) { [_condition unlock]; return YES; }
    if (_cancelled) {
        if (error) *error = [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil];
        [_condition unlock];
        return NO;
    }
    NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:_cacheURL.path error:nil];
    if ([attributes fileSize] > 0) {
        _fd = open(_cacheURL.fileSystemRepresentation, O_RDONLY);
        if (_fd >= 0) {
            _length = (NSInteger)[attributes fileSize];
            [_available addIndexesInRange:NSMakeRange(0, (NSUInteger)_length)];
            _complete = YES;
            _receivedResponse = YES;
            _opened = YES;
            [_condition unlock];
            return YES;
        }
    }
    [NSFileManager.defaultManager createDirectoryAtURL:_cacheURL.URLByDeletingLastPathComponent
                           withIntermediateDirectories:YES attributes:@{NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication} error:nil];
    _fd = open(_partialURL.fileSystemRepresentation, O_RDWR | O_CREAT | O_TRUNC, 0600);
    if (_fd < 0) {
        if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
        [_condition unlock];
        return NO;
    }
    [NSFileManager.defaultManager setAttributes:@{NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication}
                                  ofItemAtPath:_partialURL.path error:nil];
    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.HTTPCookieStorage = NSHTTPCookieStorage.sharedHTTPCookieStorage;
    configuration.URLCache = nil;
    configuration.timeoutIntervalForRequest = 35;
    configuration.timeoutIntervalForResource = 1800;
    NSOperationQueue *queue = [[NSOperationQueue alloc] init];
    queue.maxConcurrentOperationCount = 1;
    queue.qualityOfService = NSQualityOfServiceUserInitiated;
    _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:queue];
    _opened = YES;
    [self requestFromOffset:0];
    BOOL ok = [self waitForResponse:error];
    [_condition unlock];
    return ok;
}

// The condition is held by all helpers that mutate transfer state.
- (void)requestFromOffset:(NSInteger)offset {
    _retryGeneration++;
    _retryPending = NO;
    [_task cancel];
    _requestedOffset = offset;
    _receivedResponse = NO;
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:_remoteURL];
    request.allowsCellularAccess = !_unmeteredOnly;
    request.allowsExpensiveNetworkAccess = !_unmeteredOnly;
    request.allowsConstrainedNetworkAccess = !_unmeteredOnly;
    [request setValue:[NSString stringWithFormat:@"bytes=%ld-", (long)offset] forHTTPHeaderField:@"Range"];
    [request setValue:@"identity" forHTTPHeaderField:@"Accept-Encoding"];
    [request setValue:@"Mihonban-iOS/0.1" forHTTPHeaderField:@"User-Agent"];
    _task = [_session dataTaskWithRequest:request];
    [_task resume];
}

- (BOOL)isRecoverableTransportError:(NSError *)error {
    if (![error.domain isEqualToString:NSURLErrorDomain]) return NO;
    switch (error.code) {
        case NSURLErrorTimedOut:
        case NSURLErrorCannotFindHost:
        case NSURLErrorCannotConnectToHost:
        case NSURLErrorNetworkConnectionLost:
        case NSURLErrorDNSLookupFailed:
        case NSURLErrorNotConnectedToInternet:
            return YES;
        default:
            return NO;
    }
}

- (void)resetRecovery {
    _retryAttempt = 0;
    _recoveryDeadline = 0;
    _transportError = nil;
}

- (NSInteger)recoveryOffset {
    if (!_rangeSupported) return 0;
    NSInteger offset = _receivedResponse ? _writeOffset : _requestedOffset;
    if (_length >= 0 && offset >= _length) {
        // A tail probe can finish while an earlier portion is still missing.
        // Resume at the first hole instead of sending an invalid EOF range.
        __block NSUInteger missing = 0;
        [_available enumerateRangesUsingBlock:^(NSRange range, BOOL *stop) {
            if (range.location > missing) { *stop = YES; return; }
            missing = NSMaxRange(range);
        }];
        offset = (NSInteger)missing;
    }
    return offset;
}

- (void)scheduleRecovery:(NSError *)error {
    NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
    if (!_recoveryDeadline) _recoveryDeadline = now + 120;
    _transportError = error;
    if (now >= _recoveryDeadline) { _failure = error; return; }
    NSTimeInterval delay = MIN(0.5 * (1UL << MIN(_retryAttempt, (NSUInteger)4)), _recoveryDeadline - now);
    _retryAttempt = MIN(_retryAttempt + 1, (NSUInteger)4);
    NSUInteger token = ++_retryGeneration;
    _retryPending = YES;
    __weak MBHTTPInputSource *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
                   dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        MBHTTPInputSource *source = weakSelf;
        if (!source) return;
        [source->_condition lock];
        if (source->_retryPending && source->_retryGeneration == token &&
            !source->_cancelled && !source->_failure && !source->_complete) {
            if (NSProcessInfo.processInfo.systemUptime >= source->_recoveryDeadline) {
                source->_failure = source->_transportError;
                source->_retryPending = NO;
            } else {
                [source requestFromOffset:[source recoveryOffset]];
            }
            [source->_condition broadcast];
        }
        [source->_condition unlock];
    });
}

- (void)waitForProgressUntil:(NSDate *)deadline {
    // A short outage gets one bounded recovery window. Ordinary reads retain
    // their normal timeout; cancellation always wakes either kind of wait.
    NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
    NSTimeInterval remaining = _recoveryDeadline > 0 ? _recoveryDeadline - now
        : MAX(deadline.timeIntervalSinceNow, _lastProgressTime > 0 ? _lastProgressTime + 40 - now : 0);
    NSDate *limit = [NSDate dateWithTimeIntervalSinceNow:MAX(0, remaining)];
    if (![_condition waitUntilDate:limit]) {
        _failure = _transportError ?: [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorTimedOut userInfo:nil];
        _retryGeneration++;
        _retryPending = NO;
        [_task cancel];
        [_condition broadcast];
    }
}

- (BOOL)waitForResponse:(NSError **)error {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:40];
    while (!_receivedResponse && !_failure && !_cancelled) {
        [self waitForProgressUntil:deadline];
    }
    return [self checkFailure:error];
}

- (BOOL)checkFailure:(NSError **)error {
    if (_failure || _cancelled) {
        if (error) *error = _failure ?: [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil];
        return NO;
    }
    return YES;
}

- (BOOL)readBytes:(void *)buffer length:(NSInteger)length bytesRead:(NSInteger *)bytesRead error:(NSError **)error {
    *bytesRead = 0;
    if (length < 0) return NO;
    [_condition lock];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:40];
    while ([self checkFailure:error]) {
        if (*bytesRead == length || (_length >= 0 && _offset >= _length)) { [_condition unlock]; return YES; }
        __block NSRange readable = NSMakeRange(0, 0);
        [_available enumerateRangesInRange:NSMakeRange((NSUInteger)_offset, (NSUInteger)(length - *bytesRead))
                                   options:0 usingBlock:^(NSRange range, BOOL *stop) {
            if (range.location == (NSUInteger)self->_offset) readable = range;
            *stop = YES;
        }];
        if (readable.length) {
            ssize_t count = pread(_fd, (char *)buffer + *bytesRead, readable.length, _offset);
            if (count < 0 && errno == EINTR) continue;
            if (count > 0) {
                _offset += count;
                *bytesRead += count;
                if (!_requiresCompleteReads) { [_condition unlock]; return YES; }
                // Core Audio's file callbacks must not mistake a network chunk
                // boundary for a short file read while parsing MP3 metadata.
                // Accumulate the requested bytes, returning short only at EOF.
                continue;
            }
            _failure = [NSError errorWithDomain:NSPOSIXErrorDomain code:count < 0 ? errno : EIO userInfo:nil];
            continue;
        }
        // Tail probes and uncached seeks must not wait for the entire file.
        if (_rangeSupported && ((!_task && !_retryPending) || (_receivedResponse &&
            (_offset < _requestedOffset || _offset > _writeOffset + 512 * 1024)))) {
            [self requestFromOffset:_offset];
        }
        [self waitForProgressUntil:deadline];
    }
    [_condition unlock];
    return NO;
}

- (BOOL)getLength:(NSInteger *)length error:(NSError **)error {
    [_condition lock];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:40];
    while (_length < 0 && [self checkFailure:error]) {
        [self waitForProgressUntil:deadline];
    }
    BOOL ok = [self checkFailure:error];
    if (ok) *length = _length;
    [_condition unlock];
    return ok;
}

- (BOOL)getOffset:(NSInteger *)offset error:(NSError **)error {
    [_condition lock];
    *offset = _offset;
    [_condition unlock];
    return YES;
}

- (BOOL)seekToOffset:(NSInteger)offset error:(NSError **)error {
    [_condition lock];
    BOOL ok = offset >= 0 && (_length < 0 || offset <= _length) && [self checkFailure:error];
    if (ok) {
        _offset = offset;
        if (_recoveryDeadline > 0 && _rangeSupported && (_length < 0 || offset < _length) &&
            ![_available containsIndex:(NSUInteger)offset]) {
            // An explicit seek replaces active or delayed recovery of the old range.
            [self requestFromOffset:offset];
        }
    }
    else if (error) *error = _failure ?: [NSError errorWithDomain:NSPOSIXErrorDomain code:EINVAL userInfo:nil];
    [_condition unlock];
    return ok;
}

- (BOOL)supportsSeeking { return YES; }
- (BOOL)unmeteredOnly {
    [_condition lock]; BOOL value = _unmeteredOnly; [_condition unlock]; return value;
}
- (void)setUnmeteredOnly:(BOOL)value {
    [_condition lock];
    if (_unmeteredOnly != value) {
        _unmeteredOnly = value;
        // Promotion to the current song lifts only the speculative request policy.
        // Keep buffered bytes and restart a live range with the new permissions.
        if ((_task || _retryPending) && !_complete && !_cancelled && !_failure &&
            (_length < 0 || _writeOffset < _length)) {
            NSInteger nextOffset = _receivedResponse ? _writeOffset : _requestedOffset;
            [self requestFromOffset:_rangeSupported ? nextOffset : 0];
        }
    }
    [_condition unlock];
}
- (BOOL)isOpen { [_condition lock]; BOOL value = _opened && !_cancelled; [_condition unlock]; return value; }
- (BOOL)isRecovering { [_condition lock]; BOOL value = _recoveryDeadline > 0 && !_failure && !_cancelled; [_condition unlock]; return value; }
- (BOOL)atEOF { [_condition lock]; BOOL value = _length >= 0 && _offset >= _length; [_condition unlock]; return value; }
- (double)downloadedFraction {
    [_condition lock];
    double value = _length > 0 ? (double)_available.count / (double)_length : 0;
    [_condition unlock];
    return value;
}

- (void)cancel {
    [_condition lock];
    _cancelled = YES;
    _retryGeneration++;
    _retryPending = NO;
    [_task cancel];
    [_session invalidateAndCancel];
    _task = nil;
    _session = nil;
    [_condition broadcast];
    [_condition unlock];
}

- (BOOL)closeReturningError:(NSError **)error {
    [self cancel];
    // With caching disabled the growing file is only a playback buffer. The file
    // is unlinked here, but the descriptor stays open until deallocation so a
    // transfer still in flight can never write through a recycled descriptor.
    if (!_persistent) [NSFileManager.defaultManager removeItemAtURL:_partialURL error:nil];
    return YES;
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask
 didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
    [_condition lock];
    if (dataTask != _task || _cancelled) { [_condition unlock]; completionHandler(NSURLSessionResponseCancel); return; }
    NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
    NSInteger status = http.statusCode;
    BOOL valid = NO;
    if (status == 206) {
        NSString *range = [http valueForHTTPHeaderField:@"Content-Range"];
        long long start = -1, end = -1, total = -1;
        if (range && sscanf(range.UTF8String, "bytes %lld-%lld/%lld", &start, &end, &total) == 3 &&
            start == _requestedOffset && end >= start && end < total && total <= 2LL * 1024 * 1024 * 1024 &&
            (_length < 0 || _length == total)) {
            _writeOffset = (NSInteger)start;
            _length = (NSInteger)total;
            valid = YES;
        }
    } else if (status == 200) {
        // Some storage backends ignore Range. Continue sequentially, without
        // treating an offset-zero body as the requested tail of the file.
        _rangeSupported = NO;
        _writeOffset = 0;
        NSInteger length = response.expectedContentLength;
        valid = length <= 2LL * 1024 * 1024 * 1024 && (_length < 0 || _length == length);
        if (valid) _length = length;
    }
    if (!valid) _failure = [NSError errorWithDomain:@"Mihonban.HTTP" code:status userInfo:nil];
    _receivedResponse = YES;
    [_condition broadcast];
    [_condition unlock];
    completionHandler(valid ? NSURLSessionResponseAllow : NSURLSessionResponseCancel);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data {
    [_condition lock];
    if (dataTask == _task && !_cancelled && !_failure) {
        if (_writeOffset + data.length > 2LL * 1024 * 1024 * 1024 ||
            (_length >= 0 && _writeOffset + data.length > _length)) {
            _failure = [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorDataLengthExceedsMaximum userInfo:nil];
            [_task cancel];
        } else {
            NSUInteger written = 0;
            while (written < data.length) {
                ssize_t count = pwrite(_fd, (const char *)data.bytes + written, data.length - written, _writeOffset + written);
                if (count < 0 && errno == EINTR) continue;
                if (count <= 0) { _failure = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno ?: EIO userInfo:nil]; break; }
                written += count;
            }
            if (_failure) [_task cancel];
            NSUInteger previousCount = _available.count;
            [_available addIndexesInRange:NSMakeRange((NSUInteger)_writeOffset, written)];
            _writeOffset += written;
            // Replaying a server's ignored Range must not prolong an outage.
            if (_available.count > previousCount) {
                _lastProgressTime = NSProcessInfo.processInfo.systemUptime;
                [self resetRecovery];
            }
        }
        [_condition broadcast];
    }
    [_condition unlock];
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    [_condition lock];
    if (task == _task && !_cancelled) {
        _task = nil;
        if (!_failure) {
            if (!error && _length < 0) _length = _writeOffset;
            BOOL complete = _length > 0 && _available.count == (NSUInteger)_length;
            if (complete && (!error || [self isRecoverableTransportError:error])) {
                fsync(_fd);
                // Rename is atomic; partial sparse files never become cache hits.
                _complete = _persistent
                    ? rename(_partialURL.fileSystemRepresentation, _cacheURL.fileSystemRepresentation) == 0
                    : YES;
                [_session finishTasksAndInvalidate];
                _session = nil;
                [self resetRecovery];
            } else if ([self isRecoverableTransportError:error]) {
                // Transport loss does not invalidate bytes already on disk or
                // abort the decoder. Resume the growing file after a backoff.
                [self scheduleRecovery:error];
            } else if (error) {
                _failure = error;
            }
        }
        [_condition broadcast];
    }
    [_condition unlock];
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
 willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler {
    if ([_remoteURL.scheme isEqualToString:@"https"] && ![request.URL.scheme isEqualToString:@"https"]) {
        completionHandler(nil);
        return;
    }
    NSMutableURLRequest *safe = request.mutableCopy;
    [_condition lock];
    safe.allowsCellularAccess = !_unmeteredOnly;
    safe.allowsExpensiveNetworkAccess = !_unmeteredOnly;
    safe.allowsConstrainedNetworkAccess = !_unmeteredOnly;
    [_condition unlock];
    if (![request.URL.host isEqualToString:_remoteURL.host] ||
        ![request.URL.port isEqual:_remoteURL.port] || ![request.URL.scheme isEqual:_remoteURL.scheme]) {
        [safe setValue:nil forHTTPHeaderField:@"Cookie"];
        [safe setValue:nil forHTTPHeaderField:@"Authorization"];
    }
    completionHandler(safe);
}
@end

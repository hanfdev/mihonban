# Audio engine source fix

SFBAudioEngine is pinned to `8455c970de34a63422857c4b4d6fffc85b822b47`.
Its FLAC decode loop does not handle libFLAC's `ABORTED` state when
`FLAC__stream_decoder_process_single` returns success. A terminal input read
failure can therefore loop indefinitely without producing audio or notifying
the player. `apply-audio-engine-fixes.py` adds the missing abort-state check
and uses the existing decoding-error path. It verifies both the revision and
the complete source checksum, and accepts only the original source or this
exact patch.

After preparing the project and synthetic audio, run from the repository root
on macOS with Xcode. If supplying `ios/Package.resolved`, copy it into the
generated project's `project.xcworkspace/xcshareddata/swiftpm/` before resolving.

```sh
xcodebuild -resolvePackageDependencies -project ios/Mihonban.xcodeproj -scheme Mihonban -clonedSourcePackagesDirPath .spm
python3 -I ios/tools/apply-audio-engine-fixes.py .spm/checkouts/SFBAudioEngine
python3 -I ios/tools/acknowledgements.py .spm/checkouts ios/Resources/ThirdParty/Acknowledgements.txt
xcodegen generate --spec ios/project.yml
xcodebuild build -project ios/Mihonban.xcodeproj -scheme Mihonban -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/Simulator -clonedSourcePackagesDirPath .spm \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=
```

Keep `-clonedSourcePackagesDirPath .spm` on subsequent builds and tests. Rerun
the patch after dependency resolution or a package-cache reset; it is safe to
repeat. Xcode's interface may use another checkout under DerivedData. Apply
the script to that actual `SFBAudioEngine` directory before building there;
patching `.spm` does not affect another checkout. An upstream revision or source
change must be reviewed before updating the script's pinned checks.

CI applies the same patch before the device archive and both simulator suites.
The third-party notices disclose the change, and the script remains the source
of the exact modification for reproducing and relinking the build.

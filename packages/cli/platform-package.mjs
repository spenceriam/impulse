/**
 * npm platform package names. Windows ARM64 uses win32-arm64 because
 * @spenceriam/impulse-windows-arm64 was unpublished and cannot be reclaimed.
 */
export function platformPackageName(platform, arch) {
  if (platform === "windows" && arch === "arm64") {
    return "@spenceriam/impulse-win32-arm64";
  }
  return `@spenceriam/impulse-${platform}-${arch}`;
}

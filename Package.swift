// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AIUsage",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "UsageCore", targets: ["UsageCore"])],
    targets: [
        .target(name: "UsageCore", path: "Shared"),
        .testTarget(name: "UsageCoreTests", dependencies: ["UsageCore"], path: "Tests", exclude: ["test_collectors.py"])
    ]
)

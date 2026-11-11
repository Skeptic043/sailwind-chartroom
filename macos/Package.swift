// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SailwindChartroom",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")
    ],
    targets: [
        // Everything that needs no window: message parsing, the workspace file, bundled page lookup.
        .target(name: "ChartroomCore"),
        .executableTarget(
            name: "SailwindChartroom",
            dependencies: ["ChartroomCore", .product(name: "Sparkle", package: "Sparkle")],
            // The packaged app carries Sparkle in Contents/Frameworks.
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
        ),
        .testTarget(name: "ChartroomCoreTests", dependencies: ["ChartroomCore"])
    ]
)

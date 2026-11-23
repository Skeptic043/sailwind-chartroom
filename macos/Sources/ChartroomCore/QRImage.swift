import CoreImage
import Foundation

/// The code a phone scans to connect, as a PNG data URL the page shows. Drawn by macOS's own generator.
public enum QRImage {
    public static func dataURL(for text: String, scale: CGFloat = 8) -> String? {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(Data(text.utf8), forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        // A quiet margin of four modules around the code, as scanners expect.
        guard let code = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) else { return nil }
        let margin = 4 * scale
        let framed = code.transformed(by: CGAffineTransform(translationX: margin, y: margin))
            .composited(over: CIImage(color: .white).cropped(to: code.extent.insetBy(dx: -margin, dy: -margin).offsetBy(dx: margin, dy: margin)))
        let context = CIContext()
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let png = context.pngRepresentation(of: framed, format: .RGBA8, colorSpace: space) else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }
}

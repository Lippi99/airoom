import ExpoModulesCore

/// iOS side of the `furniture-ar` contract (see src/FurnitureAR.types.ts).
///
/// The RealityKit implementation is roadmap step 4. Until then this module exposes the
/// exact same props, events and methods, reports `isSupported() == false`, and rejects
/// the imperative methods with `AR_UNAVAILABLE`, so the app shows its "AR not available"
/// state instead of an empty camera.
public class FurnitureARModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FurnitureAR")

    AsyncFunction("isSupported") { () -> Bool in
      // TODO(step 4): return ARWorldTrackingConfiguration.isSupported
      return false
    }

    View(FurnitureARView.self) {
      Events(
        "onTrackingStateChanged",
        "onPlaneDetected",
        "onItemPlaced",
        "onItemSelected",
        "onPlacementBlocked",
        "onItemTapped",
        "onError"
      )

      Prop("showPlaneOverlay") { (view: FurnitureARView, show: Bool) in
        view.showPlaneOverlay = show
      }

      AsyncFunction("placeItem") { (view: FurnitureARView, item: ARItemRecord) in
        throw ARUnavailableException()
      }

      AsyncFunction("removeItem") { (view: FurnitureARView, instanceId: String) in
        throw ARUnavailableException()
      }

      AsyncFunction("clearScene") { (view: FurnitureARView) in
        throw ARUnavailableException()
      }

      AsyncFunction("captureSnapshot") { (view: FurnitureARView) -> [String: String] in
        throw ARUnavailableException()
      }
    }
  }
}

/// Mirrors `ARItem` in src/FurnitureAR.types.ts.
struct ARItemRecord: Record {
  @Field var instanceId: String = ""
  @Field var productId: String = ""
  @Field var category: String = ""
  @Field var glbUrl: String = ""
  @Field var usdzUrl: String = ""
  @Field var dimensions: ARItemDimensions = ARItemDimensions()
}

/// Real-world size in meters.
struct ARItemDimensions: Record {
  @Field var width: Double = 0
  @Field var depth: Double = 0
  @Field var height: Double = 0
}

final class ARUnavailableException: Exception {
  override var code: String { "AR_UNAVAILABLE" }
  override var reason: String { "AR on iOS is not available yet." }
}
